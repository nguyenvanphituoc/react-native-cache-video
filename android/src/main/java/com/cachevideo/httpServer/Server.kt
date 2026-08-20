package com.cachevideo.httpServer

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import fi.iki.elonen.NanoHTTPD
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.Base64
import java.util.Random
import org.json.JSONObject

class Server(private val reactContext: ReactContext, port: Int) : NanoHTTPD(port) {

  private val responses: MutableMap<String, Response> = HashMap()

  @Throws(IOException::class)
  override fun start() {
    super.start()

    Log.d(TAG, "Server started")
  }

  override fun stop() {
    super.stop()
    responses.clear()
    Log.d(TAG, "Stop server")
  }

  override fun serve(session: IHTTPSession): Response {
    Log.d(TAG, "Request received!")

    val method = session.method

    val rand = Random()
    val requestId = String.format("%d:%d", System.currentTimeMillis(), rand.nextInt(1000000))

    if (Method.GET == method) {
      val request: WritableMap
      try {
        request = fillRequestMap(session, requestId)
      } catch (e: Exception) {
        return newFixedLengthResponse(
          Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, e.message
        )
      }

      sendEvent(reactContext, SERVER_EVENT_ID, request)
    } else {
      // non-GET methods are not forwarded, matching the original implementation
    }

    while (responses[requestId] == null) {
      try {
        Thread.sleep(10)
      } catch (e: Exception) {
        Log.d(TAG, "Exception while waiting: $e")
      }
    }
    val response = responses[requestId]!!
    responses.remove(requestId)
    return response
  }

  fun respond(
    requestId: String,
    code: Int,
    type: String?,
    body: String?,
    headersJson: String? = null
  ) {
    // R10 ("the proxy never hangs"): serve() below spins until this map holds a
    // response, so EVERY exit from this method must store one. The previous
    // version logged the exception and returned, leaving serve() to spin
    // forever — the Android half of BUG-8. The catch now synthesizes a 500
    // instead of returning empty-handed.
    try {
      // newFixedLengthResponse will find encoding in type, and default encoding is ASCII_ENCODING
      val bytes = Base64.getDecoder().decode(body)
      val contentType = ContentType(type)
      val response = newFixedLengthResponse(
        Response.Status.lookup(code),
        contentType.contentTypeHeader,
        ByteArrayInputStream(bytes),
        bytes.size.toLong()
      )

      // Additional response headers (0.5.0) — Content-Range/Content-Length for
      // a 206. Parsed inside its own try: a malformed payload costs the
      // headers, never the response.
      if (!headersJson.isNullOrEmpty()) {
        try {
          val json = JSONObject(headersJson)
          json.keys().forEach { key ->
            // `optString(key, null)` compiles but warns (Kotlin infers
            // Nothing? against the platform String parameter). isNull + the
            // single-arg overload is the same behaviour, stated cleanly.
            if (!json.isNull(key)) {
              response.addHeader(key, json.optString(key))
            }
          }
        } catch (e: Exception) {
          Log.w(TAG, "respond: ignoring malformed headersJson for $requestId: $e")
        }
      }

      responses[requestId] = response
    } catch (e: Exception) {
      Log.w(TAG, "respond: failed to build a response for $requestId: $e")
      // Status.lookup(code) returns null for a non-standard code, and the
      // base64 decode throws on a plain-text body — both used to hang the
      // request. Always answer.
      responses[requestId] = newFixedLengthResponse(
        Response.Status.INTERNAL_ERROR,
        MIME_PLAINTEXT,
        "RESPOND_FAILED"
      )
    }
  }

  @Throws(Exception::class)
  private fun fillRequestMap(session: IHTTPSession, requestId: String): WritableMap {
    val method = session.method
    val request = Arguments.createMap()

    request.putString("url", session.uri + "?" + session.queryParameterString)
    request.putString("type", method.name)
    request.putString("requestId", requestId)

    session.headers.forEach { (key, value) -> request.putString(key, value) }

    val files: MutableMap<String, String> = HashMap()
    session.parseBody(files)
    if (files.isNotEmpty()) {
      request.putString("postData", files["postData"])
    }

    return request
  }

  private fun sendEvent(reactContext: ReactContext, eventName: String, params: WritableMap?) {
    reactContext.emitDeviceEvent(eventName, params)
  }

  companion object {
    private const val TAG = "HttpServer"
    private const val SERVER_EVENT_ID = "httpServerResponseReceived"
  }
}
