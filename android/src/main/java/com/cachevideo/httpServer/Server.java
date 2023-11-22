package com.cachevideo.httpServer;

import fi.iki.elonen.NanoHTTPD;
import fi.iki.elonen.NanoHTTPD.Response;
import fi.iki.elonen.NanoHTTPD.Response.Status;
import com.facebook.react.bridge.ReactContext;
import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.nio.charset.Charset;
import java.nio.charset.CharsetEncoder;
import java.util.Base64;
import java.util.Map;
import java.util.Set;
import java.util.HashMap;
import java.util.Random;
import java.util.logging.Level;

import androidx.annotation.Nullable;
import android.util.Log;

public class Server extends NanoHTTPD {
    private static final String TAG = "HttpServer";
    private static final String SERVER_EVENT_ID = "httpServerResponseReceived";

    private ReactContext reactContext;
    private Map<String, Response> responses;

    public Server(ReactContext context, int port) {
        super(port);
        reactContext = context;
        responses = new HashMap<>();
    }

    @Override
    public void start() throws IOException {
        super.start();

        Log.d(TAG, "Server started");
    }

    @Override
    public void stop() {
        super.stop();
        responses.clear();
        Log.d(TAG, "Stop server");
    }

    @Override
    public Response serve(IHTTPSession session) {
        Log.d(TAG, "Request received!");

        Method method = session.getMethod();
        String uri = session.getUri();
        Map<String, String> files = new HashMap<>();

        Random rand = new Random();
        String requestId = String.format("%d:%d", System.currentTimeMillis(), rand.nextInt(1000000));

        if (Method.GET.equals(method)) {

            WritableMap request;
            try {
                request = fillRequestMap(session, requestId);
            } catch (Exception e) {
                return newFixedLengthResponse(
                        Response.Status.INTERNAL_ERROR, MIME_PLAINTEXT, e.getMessage()
                );
            }

            this.sendEvent(reactContext, SERVER_EVENT_ID, request);
        } else {

        }

        while (responses.get(requestId) == null) {
            try {
                Thread.sleep(10);
            } catch (Exception e) {
                Log.d(TAG, "Exception while waiting: " + e);
            }
        }
        Response response = responses.get(requestId);
        responses.remove(requestId);
        return response;
    }

    public void respond(String requestId, int code, String type, String body) {
        try {
            //
//            String decodedString = new String(decodedBytes, ASCII_ENCODING);
            byte[] bytes = Base64.getDecoder().decode(body);
            // cause newFixedLengthResponse will find encoding in type, and default encoding is ASCII_ENCODING
//            responses.put(requestId, this.newFixedLengthResponse(Status.lookup(code), type, body));
            ContentType contentType = new ContentType(type);
            responses.put(requestId, newFixedLengthResponse(Status.lookup(code), contentType.getContentTypeHeader(), new ByteArrayInputStream(bytes), bytes.length));
        } catch (Exception e) {
            Log.d(TAG, "Exception while waiting: " + e);
        }
    }

    private WritableMap fillRequestMap(IHTTPSession session, String requestId) throws Exception {
        Method method = session.getMethod();
        WritableMap request = Arguments.createMap();

        request.putString("url", session.getUri() + "?" + session.getQueryParameterString());
        request.putString("type", method.name());
        request.putString("requestId", requestId);

        Map<String, String> files = new HashMap<>();
        session.parseBody(files);
        if (files.size() > 0) {
          request.putString("postData", files.get("postData"));
        }

        return request;
    }

    private void sendEvent(ReactContext reactContext, String eventName, @Nullable WritableMap params) {
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class).emit(eventName, params);
    }


}
