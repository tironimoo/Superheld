package io.github.tironimoo.ueberheld;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Thin fullscreen shell around the hosted game. The actual game is served from
 * GitHub Pages, so shipping a new version means deploying the site — this APK
 * only needs rebuilding when the icon, name or start URL change.
 */
public class MainActivity extends Activity {

    private static final String GAME_URL = "https://tironimoo.github.io/Superheld/";
    private static final String HOST = "tironimoo.github.io";

    private WebView webView;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

        boolean debuggable = (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        if (debuggable) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        // The save game lives in localStorage — without this it silently resets.
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setSupportZoom(false);
        settings.setUserAgentString(settings.getUserAgentString() + " UeberheldApp/1");

        webView.setBackgroundColor(0xFF1A0B3D);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost())) {
                    return false;
                }
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                    // No browser installed — just stay put rather than crashing.
                }
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showOfflineNotice();
                }
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                hideSystemBars();
            }
        });

        setContentView(webView);
        hideSystemBars();

        if (savedInstanceState != null) {
            webView.restoreState(savedInstanceState);
        } else {
            webView.loadUrl(GAME_URL);
        }
    }

    /**
     * Only reached when the site is unreachable AND nothing is cached yet, i.e.
     * essentially the very first launch without a connection.
     */
    private void showOfflineNotice() {
        String html = "<!doctype html><html lang='de'><head><meta charset='utf-8'>"
                + "<meta name='viewport' content='width=device-width,initial-scale=1'>"
                + "<style>html,body{height:100%;margin:0}body{display:flex;flex-direction:column;"
                + "align-items:center;justify-content:center;gap:1.2rem;background:#1a0b3d;color:#ffd76a;"
                + "font-family:sans-serif;text-align:center;padding:2rem}h1{font-size:1.4rem;margin:0}"
                + "p{color:#cbbde8;margin:0;line-height:1.5}button{font-size:1.1rem;padding:.9rem 1.8rem;"
                + "border:0;border-radius:999px;background:#ffd76a;color:#1a0b3d;font-weight:700}</style>"
                + "</head><body><h1>Keine Verbindung</h1>"
                + "<p>Überheld konnte nicht geladen werden.<br>Verbinde dich mit dem Internet und versuche es erneut.</p>"
                + "<button onclick='location.href=\"" + GAME_URL + "\"'>Nochmal versuchen</button>"
                + "</body></html>";
        webView.loadDataWithBaseURL(GAME_URL, html, "text/html", "utf-8", null);
    }

    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(
                        WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            hideSystemBars();
        }
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            if (webView.canGoBack()) {
                webView.goBack();
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        webView.onPause();
        webView.pauseTimers();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.resumeTimers();
        webView.onResume();
    }

    @Override
    protected void onDestroy() {
        webView.destroy();
        super.onDestroy();
    }
}
