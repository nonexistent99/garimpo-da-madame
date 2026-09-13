window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function gtag() {
  window.dataLayer.push(arguments);
};

window.gtag('js', new Date());
window.gtag('config', 'G-751C6EFJEC');

window.trackLandingEvent = function trackLandingEvent(name, parameters = {}) {
  window.gtag('event', name, parameters);
};
