#import "RNCacheVideoHttpProxySpec.h"

@interface CacheVideoHttpProxy : NSObject <NativeCacheVideoHttpProxySpec> {
    NSMutableDictionary* _completionBlocks;
}
@end
