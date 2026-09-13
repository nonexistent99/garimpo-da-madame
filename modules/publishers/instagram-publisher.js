const BasePublisher = require('./base-publisher');

class InstagramPublisher extends BasePublisher {
  async publish() {
    throw new Error('Instagram Publisher scaffold: configure Meta OAuth, IG User ID, media container, publish container, status e limites pela API oficial.');
  }

  async getStatus(postId) {
    return { postId, status: 'todo_official_api' };
  }
}

module.exports = InstagramPublisher;
