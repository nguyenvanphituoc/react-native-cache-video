#import "CacheVideoHttpProxy.h"
#import "React/RCTBridge.h"
#import "React/RCTLog.h"
#import "React/RCTEventDispatcher.h"

#import "GCDWebServer.h"
#import "GCDWebServerDataResponse.h"
#import "GCDWebServerDataRequest.h"
#import "GCDWebServerPrivate.h"

static RCTBridge *bridge;
@implementation CacheVideoHttpProxy

@synthesize bridge = _bridge;

GCDWebServer* _webServer;

RCT_EXPORT_MODULE(CacheVideoHttpProxy)

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

        @try {
            if ([GCDWebServerTruncateHeaderValue(request.contentType) isEqualToString:@"application/json"]) {
//          if (false) {
                GCDWebServerDataRequest* dataRequest = (GCDWebServerDataRequest*)request;
                [self.bridge.eventDispatcher sendAppEventWithName:@"httpServerResponseReceived"
                                                             body:@{@"requestId": requestId,
                                                                    @"postData": dataRequest.jsonObject,
                                                                    @"type": type,
                                                                    @"url": request.URL.relativeString}];
            } else {
                [self.bridge.eventDispatcher sendAppEventWithName:@"httpServerResponseReceived"
                                                             body:@{@"requestId": requestId,
                                                                    @"type": type,
                                                                    @"url": request.URL.relativeString}];
            }
        } @catch (NSException *exception) {
            [self.bridge.eventDispatcher sendAppEventWithName:@"httpServerResponseReceived"
                                                         body:@{@"requestId": requestId,
                                                                @"type": type,
                                                                @"url": request.URL.relativeString}];
        }
    }];
}

// Example method
// See // https://reactnative.dev/docs/native-modules-ios
RCT_EXPORT_METHOD(multiply:(double)a
                  b:(double)b
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSNumber *result = @(a * b);

    resolve(result);
}

RCT_EXPORT_METHOD(start:(NSInteger) port
                  serviceName:(NSString *) serviceName)
{
    RCTLogInfo(@"Running HTTP bridge server: %ld", port);

    _completionBlocks = [[NSMutableDictionary alloc] init];

    dispatch_sync(dispatch_get_main_queue(), ^{
        _webServer = [[GCDWebServer alloc] init];

        [self initResponseReceivedFor:_webServer forType:@"POST"];
        [self initResponseReceivedFor:_webServer forType:@"PUT"];
        [self initResponseReceivedFor:_webServer forType:@"GET"];
        [self initResponseReceivedFor:_webServer forType:@"DELETE"];

        [_webServer startWithPort:port bonjourName:serviceName];
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
                  code: (NSInteger) code
                  type: (NSString *) type
                  body: (NSString *) body)
{
//    NSData* data = [body dataUsingEncoding:NSUTF8StringEncoding];
    NSData* data = [[NSData alloc] initWithBase64EncodedString:body options:NSDataBase64DecodingIgnoreUnknownCharacters];
    GCDWebServerDataResponse* requestResponse = [[GCDWebServerDataResponse alloc] initWithData:data contentType:type];
    requestResponse.statusCode = code;

    GCDWebServerCompletionBlock completionBlock = nil;
    @synchronized (self) {
        completionBlock = [_completionBlocks objectForKey:requestId];
        [_completionBlocks removeObjectForKey:requestId];
    }
  
    if (completionBlock) {
      
      completionBlock(requestResponse);
    }
}

// Don't compile this code when we build for the old architecture.
#ifdef RCT_NEW_ARCH_ENABLED
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeCacheVideoSpecJSI>(params);
}
#endif

@end
