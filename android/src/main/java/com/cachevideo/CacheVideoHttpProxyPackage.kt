package com.cachevideo

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class CacheVideoHttpProxyPackage : BaseReactPackage() {

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == CacheVideoHttpProxyModule.NAME) {
      CacheVideoHttpProxyModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider {
    return ReactModuleInfoProvider {
      mapOf(
        CacheVideoHttpProxyModule.NAME to ReactModuleInfo(
          CacheVideoHttpProxyModule.NAME,
          CacheVideoHttpProxyModule.NAME,
          false, // canOverrideExistingModule
          false, // needsEagerInit
          false, // isCxxModule
          true // isTurboModule
        )
      )
    }
  }
}
