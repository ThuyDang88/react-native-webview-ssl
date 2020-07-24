import React from 'react';

import {
  Image,
  requireNativeComponent,
  UIManager as NotTypedUIManager,
  View,
  NativeModules,
  ImageSourcePropType,
  findNodeHandle,
} from 'react-native';

import invariant from 'invariant';

import {
  defaultOriginWhitelist,
  createOnShouldStartLoadWithRequest,
  defaultRenderError,
  defaultRenderLoading,
} from './WebViewShared';
import {
  WebViewErrorEvent,
  WebViewHttpErrorEvent,
  WebViewMessageEvent,
  WebViewNavigationEvent,
  WebViewProgressEvent,
  AndroidWebViewProps,
  NativeWebViewAndroid,
  State,
  RNCWebViewUIManager,
} from './WebViewTypes';

import styles from './WebView.styles';

const UIManager = NotTypedUIManager as RNCWebViewUIManager;

const RNCWebView = requireNativeComponent(
  'RNCWebView',
) as typeof NativeWebViewAndroid;
const { resolveAssetSource } = Image;

/**
 * Renders a native WebView.
 */
class WebView extends React.Component<AndroidWebViewProps, State> {
  static defaultProps = {
    overScrollMode: 'always',
    javaScriptEnabled: true,
    thirdPartyCookiesEnabled: true,
    scalesPageToFit: true,
    allowsFullscreenVideo: false,
    allowFileAccess: false,
    saveFormDataDisabled: false,
    cacheEnabled: true,
    androidHardwareAccelerationDisabled: false,
    originWhitelist: defaultOriginWhitelist,
  };

  static isFileUploadSupported = async () => {
    // native implementation should return "true" only for Android 5+
    return NativeModules.RNCWebView.isFileUploadSupported();
  };

  startUrl: string | null = null;

  state: State = {
    viewState: this.props.startInLoadingState ? 'LOADING' : 'IDLE',
    lastErrorEvent: null,
  };

  webViewRef = React.createRef<NativeWebViewAndroid>();

  getCommands = () => UIManager.getViewManagerConfig('RNCWebView').Commands;

  goForward = () => {
    UIManager.dispatchViewManagerCommand(
      this.getWebViewHandle(),
      this.getCommands().goForward,
      undefined
    );
  };

  goBack = () => {
    UIManager.dispatchViewManagerCommand(
      this.getWebViewHandle(),
      this.getCommands().goBack,
      undefined
    );
  };

  reload = () => {
    this.setState({
      viewState: 'LOADING',
    });
    UIManager.dispatchViewManagerCommand(
      this.getWebViewHandle(),
      this.getCommands().reload,
      undefined
    );
  };

  stopLoading = () => {
    UIManager.dispatchViewManagerCommand(
      this.getWebViewHandle(),
      this.getCommands().stopLoading,
      undefined
    );
  };

  requestFocus = () => {
    UIManager.dispatchViewManagerCommand(
      this.getWebViewHandle(),
      this.getCommands().requestFocus,
      undefined
    );
  };

  postMessage = (data: string) => {
    UIManager.dispatchViewManagerCommand(
      this.getWebViewHandle(),
      this.getCommands().postMessage,
      [String(data)],
    );
  };

  /**
   * Injects a javascript string into the referenced WebView. Deliberately does not
   * return a response because using eval() to return a response breaks this method
   * on pages with a Content Security Policy that disallows eval(). If you need that
   * functionality, look into postMessage/onMessage.
   */
  injectJavaScript = (data: string) => {
    UIManager.dispatchViewManagerCommand(
      this.getWebViewHandle(),
      this.getCommands().injectJavaScript,
      [data],
    );
  };

  /**
   * We return an event with a bunch of fields including:
   *  url, title, loading, canGoBack, canGoForward
   */
  updateNavigationState = (event: WebViewNavigationEvent) => {
    if (this.props.onNavigationStateChange) {
      this.props.onNavigationStateChange(event.nativeEvent);
    }
  };

  /**
   * Returns the native `WebView` node.
   */
  getWebViewHandle = () => {
    const nodeHandle = findNodeHandle(this.webViewRef.current);
    invariant(nodeHandle != null, 'nodeHandle expected to be non-null');
    return nodeHandle as number;
  };

  onLoadingStart = (event: WebViewNavigationEvent) => {
    const { onLoadStart } = this.props;
    const { nativeEvent: { url } } = event;
    this.startUrl = url;
    if (onLoadStart) {
      onLoadStart(event);
    }
    this.updateNavigationState(event);
  };

  onLoadingError = (event: WebViewErrorEvent) => {
    event.persist(); // persist this event because we need to store it
    const { onError, onLoadEnd } = this.props;
    if (onError) {
      onError(event);
    }
    if (onLoadEnd) {
      onLoadEnd(event);
    }
    console.warn('Encountered an error loading page', event.nativeEvent);

    this.setState({
      lastErrorEvent: event.nativeEvent,
      viewState: 'ERROR',
    });
  };

  onHttpError = (event: WebViewHttpErrorEvent) => {
    const { onHttpError } = this.props;
    if (onHttpError) {
      onHttpError(event);
    }
  }

  onLoadingFinish = (event: WebViewNavigationEvent) => {
    const { onLoad, onLoadEnd } = this.props;
    const { nativeEvent: { url } } = event;
    if (onLoad) {
      onLoad(event);
    }
    if (onLoadEnd) {
      onLoadEnd(event);
    }
    if (url === this.startUrl) {
      this.setState({
        viewState: 'IDLE',
      });
    }
    this.updateNavigationState(event);
  };

  onMessage = (event: WebViewMessageEvent) => {
    const { onMessage } = this.props;
    if (onMessage) {
      onMessage(event);
    }
  };

  onLoadingProgress = (event: WebViewProgressEvent) => {
    const { onLoadProgress } = this.props;
    const { nativeEvent: { progress } } = event;
    if (progress === 1) {
      this.setState({
        viewState: 'IDLE',
      });
    }
    if (onLoadProgress) {
      onLoadProgress(event);
    }
  };

  onShouldStartLoadWithRequestCallback = (
    shouldStart: boolean,
    url: string,
  ) => {
    if (shouldStart) {
      UIManager.dispatchViewManagerCommand(
        this.getWebViewHandle(),
        this.getCommands().loadUrl,
        [String(url)],
      );
    }
  };

  render() {
    const {
      onMessage,
      onShouldStartLoadWithRequest: onShouldStartLoadWithRequestProp,
      originWhitelist,
      renderError,
      renderLoading,
      source,
      style,
      nativeConfig = {},
      ...otherProps
    } = this.props;

    let otherView = null;

    if (this.state.viewState === 'LOADING') {
      otherView = (renderLoading || defaultRenderLoading)();
    } else if (this.state.viewState === 'ERROR') {
      const errorEvent = this.state.lastErrorEvent;
      invariant(errorEvent != null, 'lastErrorEvent expected to be non-null');
      otherView = (renderError || defaultRenderError)(
        errorEvent.domain,
        errorEvent.code,
        errorEvent.description,
      );
    } else if (this.state.viewState !== 'IDLE') {
      console.error(
        `RNCWebView invalid state encountered: ${this.state.viewState}`,
      );
    }

    const webViewStyles = [styles.container, styles.webView, style];

    if (source && 'method' in source) {
      if (source.method === 'POST' && source.headers) {
        console.warn(
          'WebView: `source.headers` is not supported when using POST.',
        );
      } else if (source.method === 'GET' && source.body) {
        console.warn('WebView: `source.body` is not supported when using GET.');
      }
    }

    const NativeWebView
      = (nativeConfig.component as typeof NativeWebViewAndroid) || RNCWebView;

    const onShouldStartLoadWithRequest = createOnShouldStartLoadWithRequest(
      this.onShouldStartLoadWithRequestCallback,
      // casting cause it's in the default props
      originWhitelist as readonly string[],
      onShouldStartLoadWithRequestProp,
    );

    const webView = (
      <NativeWebView
        key="webViewKey"
        {...otherProps}
        messagingEnabled={typeof onMessage === 'function'}
        onLoadingError={this.onLoadingError}
        onLoadingFinish={this.onLoadingFinish}
        onLoadingProgress={this.onLoadingProgress}
        onLoadingStart={this.onLoadingStart}
        onHttpError={this.onHttpError}
        onMessage={this.onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        ref={this.webViewRef}
        // TODO: find a better way to type this.
        source={resolveAssetSource(source as ImageSourcePropType)}
        style={webViewStyles}
        {...nativeConfig.props}
      />
    );

    return (
      <View style={styles.container}>
        {webView}
        {otherView}
      </View>
    );
  }
}

export default WebView;
