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
                  serviceName:(NSString *) serviceName)
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
    // thread, where a synchronous hop onto main deadlocks (INV-04).
    dispatch_async(dispatch_get_main_queue(), ^{
        _webServer = [[GCDWebServer alloc] init];

        [self initResponseReceivedFor:_webServer forType:@"POST"];
        [self initResponseReceivedFor:_webServer forType:@"PUT"];
        [self initResponseReceivedFor:_webServer forType:@"GET"];
        [self initResponseReceivedFor:_webServer forType:@"DELETE"];

        [_webServer startWithPort:(NSUInteger)port bonjourName:serviceName];
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
                  body: (NSString *) body)
{
    NSData* data = [[NSData alloc] initWithBase64EncodedString:body options:NSDataBase64DecodingIgnoreUnknownCharacters];
    GCDWebServerDataResponse* requestResponse = [[GCDWebServerDataResponse alloc] initWithData:data contentType:type];
    requestResponse.statusCode = (NSInteger)code;

    GCDWebServerCompletionBlock completionBlock = nil;
    @synchronized (self) {
        completionBlock = [_completionBlocks objectForKey:requestId];
        [_completionBlocks removeObjectForKey:requestId];
    }

    if (completionBlock) {

      completionBlock(requestResponse);
    }
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeCacheVideoHttpProxySpecJSI>(params);
}

@end
