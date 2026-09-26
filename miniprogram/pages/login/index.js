const app = getApp();

function parseChallengeId(options) {
  if (options.challengeId) return options.challengeId;

  if (options.scene) {
    const scene = decodeURIComponent(options.scene);
    const params = scene.split('&').reduce((acc, pair) => {
      const [key, value] = pair.split('=');
      if (key) acc[key] = value;
      return acc;
    }, {});
    if (params.challengeId) return params.challengeId;
  }

  if (options.q) {
    const query = decodeURIComponent(options.q).split('?')[1] || '';
    const params = query.split('&').reduce((acc, pair) => {
      const [key, value] = pair.split('=');
      if (key) acc[key] = value;
      return acc;
    }, {});
    return params.challengeId || '';
  }

  return '';
}

Page({
  data: {
    challengeId: '',
    loading: false,
    success: false,
    canRetry: false,
    message: '请确认授权，完成后返回浏览器登录页。',
    reviewUsername: '',
    reviewPassword: '',
    reviewLoading: false,
    reviewSuccess: false,
    reviewMessage: '',
    reviewMode: false,
    configLoaded: false,
    reviewChallengeId: 'wmc_review_audit'
  },

  onLoad(options) {
    const challengeId = parseChallengeId(options);
    if (!challengeId) {
      this.setData({
        message: '请从 LIBEREAL 网站手机登录页进入小程序完成微信登录。',
        canRetry: false
      });
      this.loadConfig();
      return;
    }

    this.setData({ challengeId });
    this.setData({
      message: '已读取登录请求，请点击下方按钮确认微信授权。'
    });
  },

  loadConfig() {
    wx.request({
      url: `${app.globalData.apiBaseUrl}/api/auth/wechat-mini/config`,
      method: 'GET',
      success: (res) => {
        const data = res.data || {};
        this.setData({
          reviewMode: Boolean(data.reviewMode),
          reviewChallengeId: data.reviewChallengeId || 'wmc_review_audit',
          configLoaded: true,
          message: data.reviewMode
            ? '请输入账号信息完成登录。'
            : '请从 LIBEREAL 网站手机登录页进入小程序完成微信登录。'
        });
      },
      fail: () => {
        this.setData({
          reviewMode: false,
          configLoaded: true,
          message: '请从 LIBEREAL 网站手机登录页进入小程序完成微信登录。'
        });
      }
    });
  },

  handleReviewUsernameInput(event) {
    this.setData({ reviewUsername: event.detail.value });
  },

  handleReviewPasswordInput(event) {
    this.setData({ reviewPassword: event.detail.value });
  },

  handleReviewLogin() {
    if (this.data.reviewLoading) return;
    const username = this.data.reviewUsername.trim();
    const password = this.data.reviewPassword.trim();
    if (!username || !password) {
      this.setData({
        reviewSuccess: false,
        reviewMessage: '请输入邮箱和密码。'
      });
      return;
    }

    this.setData({
      reviewLoading: true,
      reviewSuccess: false,
      reviewMessage: '正在登录...'
    });

    wx.request({
      url: `${app.globalData.apiBaseUrl}/api/auth/wechat-mini/review-login`,
      method: 'POST',
      header: {
        'content-type': 'application/json'
      },
      data: {
        username,
        password
      },
      success: (res) => {
        const data = res.data || {};
        if (res.statusCode >= 200 && res.statusCode < 300 && data.ok) {
          this.setData({
            reviewLoading: false,
            reviewSuccess: false,
            reviewMessage: '账号验证通过，正在进行微信授权...',
            challengeId: this.data.reviewChallengeId,
            message: '账号验证通过，正在进行微信授权...'
          }, () => this.handleLogin());
          return;
        }

        this.setData({
          reviewLoading: false,
          reviewSuccess: false,
          reviewMessage: data.error || '账号或密码错误，请重新输入。'
        });
      },
      fail: () => {
        this.setData({
          reviewLoading: false,
          reviewSuccess: false,
          reviewMessage: '无法连接 LIBEREAL 服务器，请确认 request 合法域名已配置。'
        });
      }
    });
  },

  handleLogin() {
    if (!this.data.challengeId || this.data.loading) return;
    this.setData({
      loading: true,
      canRetry: false,
      message: '正在获取微信登录凭证...'
    });

    wx.login({
      success: ({ code }) => {
        console.log('[wechat-mini] wx.login success', { hasCode: Boolean(code) });
        if (!code) {
          this.setData({
            loading: false,
            canRetry: true,
            message: '微信登录凭证为空，请重试。'
          });
          return;
        }
        this.confirmLogin(code);
      },
      fail: (err) => {
        console.error('[wechat-mini] wx.login fail', err);
        this.setData({
          loading: false,
          canRetry: true,
          message: '无法调用微信登录，请重试。'
        });
      }
    });
  },

  confirmLogin(code) {
    wx.request({
      url: `${app.globalData.apiBaseUrl}/api/auth/wechat-mini/confirm`,
      method: 'POST',
      header: {
        'content-type': 'application/json'
      },
      data: {
        challengeId: this.data.challengeId,
        code
      },
      success: (res) => {
        console.log('[wechat-mini] confirm response', res.statusCode, res.data);
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const message = res.data && res.data.message
            ? res.data.message
            : '授权成功。请返回浏览器，网页会自动继续登录。';
          this.setData({
            loading: false,
            success: true,
            canRetry: false,
            message,
            reviewSuccess: this.data.reviewMode,
            reviewMessage: this.data.reviewMode ? message : this.data.reviewMessage
          });
          wx.showToast({
            title: '授权成功',
            icon: 'success'
          });
          return;
        }

        const error = res.data && res.data.error
          ? res.data.error
          : `授权失败，请重试。（HTTP ${res.statusCode}）`;
        this.setData({
          loading: false,
          canRetry: true,
          message: error
        });
        wx.showToast({
          title: '授权失败',
          icon: 'none'
        });
      },
      fail: (err) => {
        console.error('[wechat-mini] confirm request fail', err);
        this.setData({
          loading: false,
          canRetry: true,
          message: '无法连接 LIBEREAL 服务器，请确认小程序 request 合法域名已配置。'
        });
        wx.showToast({
          title: '连接失败',
          icon: 'none'
        });
      }
    });
  }
});
