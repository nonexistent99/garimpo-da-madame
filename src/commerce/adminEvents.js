const subscribers = new Set();

let sequence = 0;
let lastEventAt = null;

function publish(type, details = {}) {
  const event = {
    id: `${Date.now()}-${++sequence}`,
    type,
    at: new Date().toISOString(),
    ...details,
  };

  lastEventAt = event.at;
  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch {
      subscribers.delete(subscriber);
    }
  }

  return event;
}

function subscribe(subscriber) {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

function getStatus() {
  return {
    connectedClients: subscribers.size,
    lastEventAt,
  };
}

module.exports = { publish, subscribe, getStatus };
