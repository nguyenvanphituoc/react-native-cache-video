#import "CacheVideoHttpProxy.h"
#import "React/RCTLog.h"

#import "GCDWebServer.h"
#import "GCDWebServerDataResponse.h"
#import "GCDWebServerDataRequest.h"
#import "GCDWebServerPrivate.h"

@implementation CacheVideoHttpProxy

@synthesize callableJSModules = _callableJSModules;

GCDWebServer* _webServer;

RCT_EXPORT_MODULE(CacheVideoHttpProxy)

// Bridgeless-safe device event emission: same JS surface as DeviceEventEmitter,
// without touching the (removed) bridge. See contracts/http-server-event.contract.md.
- (void)sendServerEvent:(NSDictionary *)body {
    [_callableJSModules invokeModule:@"RCTDeviceEventEmitter"
                              method:@"emit"
                            withArgs:@[@"httpServerResponseReceived", body]];
}

- (void)initResponseReceivedFor:(GCDWebServer *)server forType:(NSString*)type {
    [server addDefaultHandlerForMethod:type
                          requestClass:[GCDWebServerDataRequest class]
                     asyncProcessBlock:^(GCDWebServerRequest* request, GCDWebServerCompletionBlock completionBlock) {

        long long milliseconds = (long long)([[NSDate date] timeIntervalSince1970] * 1000.0);
        int r = arc4random_uniform(1000000);
        NSString *requestId = [NSString stringWithFormat:@"%lld:%d", milliseconds, r];

         @synchronized (self) {
           [self->_completionBlocks setObject:completionBlock forKey:requestId];
         }

        NSMutableDictionary *combinedDict = [request.headers mutableCopy];

        @try {
            if ([GCDWebServerTruncateHeaderValue(request.contentType) isEqualToString:@"application/json"]) {
                GCDWebServerDataRequest* dataRequest = (GCDWebServerDataRequest*)request;

              [combinedDict addEntriesFromDictionary:@{@"requestId": requestId,
                                                       @"postData": dataRequest.jsonObject,
                                                       @"type": type,
                                                       @"url": request.URL.relativeString}];
                [self sendServerEvent:combinedDict];
            } else {
              [combinedDict addEntriesFromDictionary:@{@"requestId": requestId,
                                                       @"type": type,
                                                       @"url": request.URL.relativeString}];

                [self sendServerEvent:combinedDict];
            }
        } @catch (NSException *exception) {
            [combinedDict addEntriesFromDictionary:@{@"requestId": requestId,
                                                     @"type": type,
                                                     @"url": request.URL.relativeString}];

            [self sendServerEvent:combinedDict];
        }
    }];
}

RCT_EXPORT_METHOD(start:(double) port
                  serviceName:(NSString *) serviceName
                  resolve:(RCTPromiseResolveBlock) resolve
                  reject:(RCTPromiseRejectBlock) reject)
{
    RCTLogInfo(@"Running HTTP bridge server: %ld", (long)port);

    @synchronized (self) {
        // Init-once: re-creating the map on a repeat start would orphan
        // completion blocks of requests still in flight (INV-01).
        if (_completionBlocks == nil) {
            _completionBlocks = [[NSMutableDictionary alloc] init];
        }
    }

    // Async dispatch only: TurboModule methods may already run on the main
    // thread, where a synchronous hop onto main deadlocks (INV-04). The
    // promise settles exactly once, from inside this block — RCT promise
    // blocks are safe to invoke from any thread.
    dispatch_async(dispatch_get_main_queue(), ^{
        // Retry-safe repeat start: stop and release any previous instance
        // before creating a new one — reassigning without stopping leaks a
        // running server (contract: native-start.contract.md).
        if (_webServer != nil) {
            if (_webServer.isRunning) {
                [_webServer stop];
            }
            [_webServer removeAllHandlers];
            _webServer = nil;
        }

        _webServer = [[GCDWebServer alloc] init];

        [self initResponseReceivedFor:_webServer forType:@"POST"];
        [self initResponseReceivedFor:_webServer forType:@"PUT"];
        [self initResponseReceivedFor:_webServer forType:@"GET"];
        [self initResponseReceivedFor:_webServer forType:@"DELETE"];

        // startWithOptions:error: — same bind as startWithPort:bonjourName:,
        // but surfaces a reasoned NSError instead of a discarded BOOL.
        NSMutableDictionary* options = [NSMutableDictionary dictionary];
        options[GCDWebServerOption_Port] = @((NSUInteger)port);
        if (serviceName != nil) {
            options[GCDWebServerOption_BonjourName] = serviceName;
        }

        NSError* error = nil;
        if ([_webServer startWithOptions:options error:&error]) {
            // Resolve with the actually-bound port (native truth).
            resolve(@(_webServer.port));
        } else {
            // Failed bind: release the dead instance so a later stop/start
            // never touches a server that was never running.
            [_webServer removeAllHandlers];
            _webServer = nil;
            NSString* message = error != nil
                ? error.localizedDescription
                : [NSString stringWithFormat:@"Failed to bind HTTP bridge server on port %ld", (long)port];
            reject(@"PORT_BIND_FAILED", message, error);
        }
    });
}

RCT_EXPORT_METHOD(stop)
{
    RCTLogInfo(@"Stopping HTTP bridge server");
    if (_webServer != nil) {
        [_webServer stop];
        [_webServer removeAllHandlers];
        [_completionBlocks removeAllObjects];
        _webServer = nil;
    }
}

RCT_EXPORT_METHOD(respond: (NSString *) requestId
                  code: (double) code
                  type: (NSString *) type
                  body: (NSString *) body
                  headersJson: (NSString *) headersJson)
{
    NSData* data = [[NSData alloc] initWithBase64EncodedString:body options:NSDataBase64DecodingIgnoreUnknownCharacters];
    GCDWebServerDataResponse* requestResponse = [[GCDWebServerDataResponse alloc] initWithData:data contentType:type];
    requestResponse.statusCode = (NSInteger)code;

    // Additional response headers (0.5.0) — Content-Range/Content-Length for a
    // 206, and anything else a handler needs to pass through. Parsed
    // defensively: a malformed or non-object payload is IGNORED rather than
    // thrown, because the completion block below MUST still run. Dropping a
    // header degrades the response; failing to complete hangs the request.
    if (headersJson != nil && headersJson.length > 0) {
        NSError* jsonError = nil;
        id parsed = [NSJSONSerialization JSONObjectWithData:[headersJson dataUsingEncoding:NSUTF8StringEncoding]
                                                    options:0
                                                      error:&jsonError];
        if (jsonError == nil && [parsed isKindOfClass:[NSDictionary class]]) {
            [(NSDictionary*)parsed enumerateKeysAndObjectsUsingBlock:^(id key, id value, BOOL* stop) {
                if ([key isKindOfClass:[NSString class]] && [value isKindOfClass:[NSString class]]) {
                    [requestResponse setValue:(NSString*)value forAdditionalHeader:(NSString*)key];
                }
            }];
        } else {
            RCTLogWarn(@"respond: ignoring malformed headersJson for request %@", requestId);
        }
    }

    GCDWebServerCompletionBlock completionBlock = nil;
    @synchronized (self) {
        completionBlock = [_completionBlocks objectForKey:requestId];
        [_completionBlocks removeObjectForKey:requestId];
    }

    if (completionBlock) {

      completionBlock(requestResponse);
    }
}

// iOS Conformance (A5) — reject-"not implemented" stubs satisfying
// <NativeCacheVideoHttpProxySpec> protocol conformance (RH1) after codegen adds
// downloadToFile/cancelDownload to the shared Spec for the Android streaming-download
// transport. JS never calls either on iOS (A3's `Platform.OS === 'android'` gate) — no
// functional iOS download behavior change (R5). See
// shapeup/android-streamed-downloads/spec/contracts/android-download-transport.contract.md#iOS-Conformance-A5.
RCT_EXPORT_METHOD(downloadToFile: (NSString *) url
                  headersJson: (NSString *) headersJson
                  destPath: (NSString *) destPath
                  requestId: (NSString *) requestId
                  resolve: (RCTPromiseResolveBlock) resolve
                  reject: (RCTPromiseRejectBlock) reject)
{
    reject(@"NOT_IMPLEMENTED", @"downloadToFile is not implemented on iOS — the Android-only transport fix does not apply here", nil);
}

RCT_EXPORT_METHOD(cancelDownload: (NSString *) requestId
                  resolve: (RCTPromiseResolveBlock) resolve
                  reject: (RCTPromiseRejectBlock) reject)
{
    reject(@"NOT_IMPLEMENTED", @"cancelDownload is not implemented on iOS — the Android-only transport fix does not apply here", nil);
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeCacheVideoHttpProxySpecJSI>(params);
}

@end
