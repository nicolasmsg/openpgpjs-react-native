#import "RNOpenPGP.h"
#import "RCTBridgeModule.h"
#import "RCTBridge.h"

@implementation RNOpenPGP

RCT_EXPORT_MODULE()

@synthesize bridge = _bridge;

RCT_EXPORT_METHOD(randomBytes:(NSUInteger)length
                  callback:(RCTResponseSenderBlock)callback)
{
    callback(@[[NSNull null], [self randomBytes:length]]);
}

- (NSString *) randomBytes:(NSUInteger)length
{
    NSMutableData* bytes = [NSMutableData dataWithLength:length];
    SecRandomCopyBytes(kSecRandomDefault, length, [bytes mutableBytes]);
    return [bytes base64EncodedStringWithOptions:0];
}

- (NSDictionary *)constantsToExport
{
    return @{
        @"seed": [self randomBytes:4096]
    };
};

@end
