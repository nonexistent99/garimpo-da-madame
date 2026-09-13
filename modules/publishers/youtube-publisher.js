const BasePublisher = require('./base-publisher');

class YouTubePublisher extends BasePublisher {
  async publish() {
    throw new Error('YouTube Publisher scaffold: configure Google OAuth, refresh token e videos.insert pela API oficial.');
  }

  async getStatus(postId) {
    return { postId, status: 'todo_official_api' };
  }
}

module.exports = YouTubePublisher;
