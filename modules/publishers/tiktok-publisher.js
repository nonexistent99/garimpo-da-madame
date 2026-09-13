const BasePublisher = require('./base-publisher');

class TikTokPublisher extends BasePublisher {
  async publish() {
    throw new Error('TikTok Publisher scaffold: configure OAuth, refresh token, creator_info, upload/init, direct post e status pela API oficial.');
  }

  async getStatus(postId) {
    return { postId, status: 'todo_official_api' };
  }
}

module.exports = TikTokPublisher;
