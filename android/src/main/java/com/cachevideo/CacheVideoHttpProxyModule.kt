package com.cachevideo

import android.util.Log
import com.cachevideo.httpServer.Server
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import java.io.IOException

@ReactModule(name = CacheVideoHttpProxyModule.NAME)
class CacheVideoHttpProxyModule(private val reactContext: ReactApplicationContext) :
  NativeCacheVideoHttpProxySpec(reactContext), LifecycleEventListener {

  init {
    reactContext.addLifecycleEventListener(this)
  }

  override fun start(port: Double, serviceName: String) {
    Log.d(NAME, "Initializing server...")
    Companion.port = port.toInt()

    startServer()
  }

  override fun stop() {
    Log.d(NAME, "Stopping server...")

    stopServer()
  }

  // type/body are declared nullable: JS passes the upstream Content-Type header
  // through verbatim, which is null when the origin serves lowercase header names
  // (HTTP/2). The original Java implementation accepted null silently; a non-null
  // Kotlin parameter turns that into an NPE that tears down the React instance.
  override fun respond(requestId: String, code: Double, type: String?, body: String?) {
    server?.respond(requestId, code.toInt(), type, body)
  }

  override fun onHostResume() {
  }

  override fun onHostPause() {
  }

  override fun onHostDestroy() {
    stopServer()
  }

  private fun startServer() {
    if (port == 0) {
      return
    }

    if (server == null) {
      server = Server(reactContext, port)
    }
    try {
      server?.start()
    } catch (e: IOException) {
      Log.e(NAME, e.message ?: "failed to start server")
    }
  }

  private fun stopServer() {
    if (server != null) {
      server?.stop()
      server = null
      port = 0
    }
  }

  companion object {
    const val NAME = "CacheVideoHttpProxy"

    // Shared across instances, matching the original Java static fields
    private var port: Int = 0
    private var server: Server? = null
  }
}
