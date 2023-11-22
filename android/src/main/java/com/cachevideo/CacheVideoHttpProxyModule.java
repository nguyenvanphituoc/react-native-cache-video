package com.cachevideo;

import android.util.Log;

import androidx.annotation.NonNull;

import com.cachevideo.httpServer.Server;
import com.facebook.react.bridge.LifecycleEventListener;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactMethod;

import java.io.IOException;

public class CacheVideoHttpProxyModule extends com.cachevideo.CacheVideoHttpProxySpec implements LifecycleEventListener {
  public static final String NAME = "CacheVideoHttpProxy";
  private static int port;
  private static Server server = null;

  ReactApplicationContext reactContext;

  CacheVideoHttpProxyModule(ReactApplicationContext context) {
    super(context);

    this.reactContext = context;

    this.reactContext.addLifecycleEventListener(this);
  }

  @Override
  @NonNull
  public String getName() {
    return NAME;
  }


  // Example method
  // See https://reactnative.dev/docs/native-modules-android
  @ReactMethod
  public void multiply(double a, double b, Promise promise) {
    promise.resolve(a * b);
  }

  @ReactMethod
  public void start(int port, String serviceName) {
      Log.d(NAME, "Initializing server...");
      this.port = port;

      startServer();
  }

  @ReactMethod
  public void stop() {
      Log.d(NAME, "Stopping server...");

      stopServer();
  }

  @ReactMethod
  public void respond(String requestId, int code, String type, String body) {
      if (server != null) {
          server.respond(requestId, code, type, body);
      }
  }

  @Override
  public void onHostResume() {

  }

  @Override
  public void onHostPause() {

  }

  @Override
  public void onHostDestroy() {
      stopServer();
  }

  private void startServer() {
      if (this.port == 0) {
          return;
      }

      if (server == null) {
          server = new Server(this.reactContext, port);
      }
      try {
          server.start();
      } catch (IOException e) {
          Log.e(NAME, e.getMessage());
      }
  }

  private void stopServer() {
      if (server != null) {
          server.stop();
          server = null;
          port = 0;
      }
  }
}
