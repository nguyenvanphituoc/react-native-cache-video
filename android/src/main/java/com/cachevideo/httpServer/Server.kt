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

  fun respond(requestId: String, code: Int, type: String?, body: String?) {
    try {
      // newFixedLengthResponse will find encoding in type, and default encoding is ASCII_ENCODING
      val bytes = Base64.getDecoder().decode(body)
      val contentType = ContentType(type)
      responses[requestId] = newFixedLengthResponse(
        Response.Status.lookup(code),
        contentType.contentTypeHeader,
        ByteArrayInputStream(bytes),
        bytes.size.toLong()
      )
    } catch (e: Exception) {
      Log.d(TAG, "Exception while waiting: $e")
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
