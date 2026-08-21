package com.cachevideo

import android.util.Log
import com.cachevideo.httpServer.Server
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.network.OkHttpClientProvider
import java.io.File
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Request
import okhttp3.Response
import okio.buffer
import okio.sink
import org.json.JSONObject

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
  override fun respond(
    requestId: String,
    code: Double,
    type: String?,
    body: String?,
    headersJson: String?
  ) {
    server?.respond(requestId, code.toInt(), type, body, headersJson)
  }

  // Opens an OkHttp request for `url` with the forwarded `headersJson`, streams
  // the response body straight to `destPath` via an Okio file sink (constant
  // buffer size regardless of Content-Length — never held whole in memory,
  // INV-02), and resolves a JSON-encoded {status, headers, contentLength,
  // contentRange} string. The `Call` is tracked in `downloads`, keyed by
  // `requestId` (same key-space convention as `Server`'s NanoHTTPD `responses`
  // map, RH3), so `cancelDownload` can find and cancel it.
  //
  // Reuses RN's own shared OkHttpClientProvider singleton rather than building
  // a fresh OkHttpClient — the same choice react-native-blob-util's own
  // ReactNativeBlobUtilImpl already makes for this exact kind of streaming
  // download (`OkHttpClientProvider.getOkHttpClient()`), so this module adds
  // no second connection/thread pool app-wide (discovered-seed.md item 1).
  //
  // Non-2xx origin status still RESOLVES (mirrors blob-util's contract, R3);
  // only a transport/write failure or a concurrent cancelDownload rejects.
  // See shapeup/android-streamed-downloads/spec/contracts/android-download-transport.contract.md#Method-downloadToFile
  override fun downloadToFile(
    url: String,
    headersJson: String,
    destPath: String,
    requestId: String,
    promise: Promise
  ) {
    val call: Call
    try {
      val requestBuilder = Request.Builder().url(url)
      applyHeaders(requestBuilder, headersJson, requestId)
      call = OkHttpClientProvider.getOkHttpClient().newCall(requestBuilder.build())
    } catch (e: Exception) {
      // Never leave the promise unresolved (R10, same discipline as
      // Server.respond's own catch) — a malformed url is the only thing that
      // can throw synchronously here, before any Call exists to track.
      promise.reject("DOWNLOAD_FAILED", e.message ?: "downloadToFile failed for $requestId", e)
      return
    }
    downloads[requestId] = call

    call.enqueue(object : Callback {
      override fun onFailure(call: Call, e: IOException) {
        downloads.remove(requestId)
        rejectForFailure(promise, call, requestId, e)
      }

      override fun onResponse(call: Call, response: Response) {
        try {
          response.use { res ->
            val body = res.body
              ?: throw IOException("downloadToFile: empty response body for $requestId")
            File(destPath).also { it.parentFile?.mkdirs() }
              .sink()
              .buffer()
              .use { sink -> sink.writeAll(body.source()) }
            promise.resolve(resultJson(res))
          }
        } catch (e: IOException) {
          rejectForFailure(promise, call, requestId, e)
        } finally {
          downloads.remove(requestId)
        }
      }
    })
  }

  // Cancels the tracked Call for `requestId`, aborting its streaming read so
  // `downloadToFile`'s own promise rejects. No tracked Call (already
  // completed/cancelled/never started) → resolves as a no-op, never rejects
  // (matches today's iOS/blob-util cancellation tolerance, R2).
  // See shapeup/android-streamed-downloads/spec/contracts/android-download-transport.contract.md#Method-cancelDownload
  override fun cancelDownload(requestId: String, promise: Promise) {
    downloads.remove(requestId)?.cancel()
    promise.resolve(null)
  }

  private fun applyHeaders(builder: Request.Builder, headersJson: String, requestId: String) {
    if (headersJson.isBlank() || headersJson == "{}") {
      return
    }
    try {
      val json = JSONObject(headersJson)
      json.keys().forEach { key ->
        if (!json.isNull(key)) {
          builder.addHeader(key, json.optString(key))
        }
      }
    } catch (e: Exception) {
      Log.w(NAME, "downloadToFile: ignoring malformed headersJson for $requestId: $e")
    }
  }

  private fun rejectForFailure(promise: Promise, call: Call, requestId: String, e: IOException) {
    if (call.isCanceled()) {
      promise.reject("DOWNLOAD_CANCELLED", "downloadToFile cancelled for $requestId", e)
    } else {
      promise.reject("DOWNLOAD_FAILED", e.message ?: "downloadToFile failed for $requestId", e)
    }
  }

  // Preserves whatever header casing/shape the origin sent — the same
  // casing/shape contract contentLengthOf/contentRangeOf (verifiedWrite.ts /
  // PreCacheProvider.ts) already scan case-insensitively for blob-util's
  // respInfo.headers (discovered-seed.md item 3).
  private fun resultJson(response: Response): String {
    val headers = JSONObject()
    for (name in response.headers.names()) {
      headers.put(name, response.headers[name])
    }
    val result = JSONObject()
    result.put("status", response.code)
    result.put("headers", headers)
    result.put("contentLength", response.header("Content-Length")?.toLongOrNull() ?: JSONObject.NULL)
    result.put("contentRange", response.header("Content-Range") ?: JSONObject.NULL)
    return result.toString()
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

    // In-flight downloadToFile Calls, keyed by requestId — same key-space
    // convention as Server's NanoHTTPD `responses` map (RH3). Written from the
    // calling thread and read/removed from OkHttp's callback thread, so this
    // must be a thread-safe map.
    private val downloads: MutableMap<String, Call> = ConcurrentHashMap()
  }
}
