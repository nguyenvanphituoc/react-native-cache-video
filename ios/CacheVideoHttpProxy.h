
#ifdef RCT_NEW_ARCH_ENABLED
#import "RNCacheVideoHttpProxySpec.h"

@interface CacheVideoHttpProxy : NSObject <NativeCacheVideoHttpProxySpec> {
    NSMutableDictionary* _completionBlocks;
}
@end

#else
#import <React/RCTBridgeModule.h>

@interface CacheVideoHttpProxy : NSObject <RCTBridgeModule> {
    NSMutableDictionary* _completionBlocks;
}
@end

#endif
