window.dataLayer = window.dataLayer || [];
window.gtag = window.gtag || function gtag() {
  window.dataLayer.push(arguments);
};

window.gtag('js', new Date());
window.gtag('config', 'G-NZ5RHY9ST6');

window.trackLandingEvent = function trackLandingEvent(name, parameters = {}) {
  window.gtag('event', name, parameters);
};
