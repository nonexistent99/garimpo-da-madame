const TelegramBot = require('node-telegram-bot-api');
const BasePublisher = require('./base-publisher');
const { safeJsonParse } = require('../common');

class TelegramPublisher extends BasePublisher {
  constructor() {
    super();
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    this.bot = this.token ? new TelegramBot(this.token, { polling: false }) : null;
  }

  validateAccount(account) {
    super.validateAccount(account);
    const metadata = safeJsonParse(account.metadata_json, account.metadata || {});
    if (!this.bot) throw new Error('TELEGRAM_BOT_TOKEN nao configurado');
    if (!metadata.chat_id && !metadata.target_id) throw new Error('metadata.chat_id da conta Telegram nao configurado');
    return true;
  }

  async publish({ account, creative, caption, trackingUrl }) {
    this.validateAccount(account);
    const metadata = safeJsonParse(account.metadata_json, account.metadata || {});
    const chatId = metadata.chat_id || metadata.target_id;
    const finalCaption = [caption || creative.caption || '', trackingUrl].filter(Boolean).join('\n\n');
    let result;

    if (creative.video_path) {
      result = await this.bot.sendVideo(chatId, creative.video_path, { caption: finalCaption });
    } else {
      result = await this.bot.sendMessage(chatId, finalCaption);
    }

    return {
      status: 'published',
      platform_post_id: String(result.message_id),
      public_url: metadata.public_base_url ? `${metadata.public_base_url}/${result.message_id}` : null,
    };
  }
}

module.exports = TelegramPublisher;
