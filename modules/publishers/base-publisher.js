class BasePublisher {
  validateAccount(account) {
    if (!account) throw new Error('conta ausente');
    if (!['active', 'warming_up'].includes(account.status)) throw new Error('conta nao esta ativa');
    return true;
  }

  async publish() {
    throw new Error('publish nao implementado');
  }

  async getStatus() {
    return { status: 'unknown' };
  }
}

module.exports = BasePublisher;
