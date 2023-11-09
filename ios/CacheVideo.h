
#ifdef RCT_NEW_ARCH_ENABLED
#import "RNCacheVideoSpec.h"

@interface CacheVideo : NSObject <NativeCacheVideoSpec>
#else
#import <React/RCTBridgeModule.h>

@interface CacheVideo : NSObject <RCTBridgeModule>
#endif

@end
