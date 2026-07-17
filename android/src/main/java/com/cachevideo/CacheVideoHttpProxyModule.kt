package com.cachevideo

import android.util.Log
import com.cachevideo.httpServer.Server
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import java.io.IOException

@ReactModule(name = CacheVideoHttpProxyModule.NAME)
class CacheVideoHttpProxyModule(private val reactContext: ReactApplicationContext) :
  NativeCacheVideoHttpProxySpec(reactContext), LifecycleEventListener {

  init {
    reactContext.addLifecycleEventListener(this)
  }

  // Matches the codegen spec `void start(double, String, Promise)` — the
  // generated spec class is a plain ReactContextBaseJavaModule, so this same
  // implementation serves both old and new architecture (spike-proven).
  // Resolves with the bound port (NanoHTTPD binds synchronously) or rejects
  // PORT_BIND_FAILED with the IOException reason — never log-and-continue.
  override fun start(port: Double, serviceName: String, promise: Promise) {
    Log.d(NAME, "Initializing server...")

    // Retry choreography: a live instance is stopped first so a repeat start
    // on a fresh port can never silently no-op (issue #8 root).
    stopServer()

    val requestedPort = port.toInt()
    Companion.port = requestedPort
    server = Server(reactContext, requestedPort)
    try {
      server?.start()
      promise.resolve(requestedPort)
    } catch (e: IOException) {
      // release the half-started instance; NanoHTTPD.stop() is null-safe
      stopServer()
      promise.reject("PORT_BIND_FAILED", e.message ?: "failed to start server", e)
    }
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
