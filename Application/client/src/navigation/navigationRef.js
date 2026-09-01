import { createNavigationContainerRef, CommonActions } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

function runWhenNavigationReady(action, attempt = 0) {
  if (navigationRef.isReady()) {
    navigationRef.dispatch(action);
    return;
  }

  if (attempt < 20) {
    setTimeout(() => runWhenNavigationReady(action, attempt + 1), 50);
  }
}

export function resetToLogin() {
  runWhenNavigationReady(
    CommonActions.reset({
      index: 0,
      routes: [{ name: 'Auth', state: { routes: [{ name: 'Login' }] } }],
    })
  );
}

export function resetToHome() {
  runWhenNavigationReady(
    CommonActions.reset({
      index: 0,
      routes: [{ name: 'Home' }],
    })
  );
}

export function resetToMain() {
  runWhenNavigationReady(
    CommonActions.reset({
      index: 0,
      routes: [{ name: 'Main' }],
    })
  );
}

export function safeGoBack(navigation, fallbackRoute = 'MainTabs', fallbackParams = { screen: 'Dashboard' }) {
  if (!navigation) {
    return;
  }

  if (navigation.canGoBack()) {
    navigation.goBack();
    return;
  }

  const parent = navigation.getParent?.();
  if (parent?.canGoBack?.()) {
    parent.goBack();
    return;
  }

  const tabRoutes = ['Dashboard', 'Record', 'History', 'Profile'];
  if (tabRoutes.includes(fallbackRoute)) {
    navigation.navigate(fallbackRoute);
    return;
  }

  navigation.navigate(fallbackRoute, fallbackParams);
}
