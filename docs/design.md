# Switch Tab 设计讨论

## 已确认

- 首版支持 macOS Chrome。
- 按最近使用顺序切换；A → B → C 后首次选择 B。
- 按住 Command 循环选择，松开后确认；Enter 提供兜底。
- 范围限于当前窗口仍打开的标签，不跨窗口，不恢复已关闭标签。
- 默认 ⌘X，允许修改；按住 ⌘ 重复 X 循环，松开确认，Enter 兜底。
- 普通网页显示居中浮层；受限页面通过相对来源窗口居中的独立小窗口切换。接受浮层所需网站访问权限。
- 展示最近 5 个标签的网站图标、标题、域名；使用最近访问时采集的缩略图，从左到右排列卡片；不提供搜索或关闭标签。
- Shift 反向循环、Esc 取消、点击候选确认、失焦取消。
- 选择期间仅移动高亮，不激活标签；候选顺序在一次切换会话中保持固定。
- 快速轻按直接返回上一标签，持续按住约 150ms 才显示面板；时序需要实测。
- 最多展示 5 个其他标签，排除当前标签；默认高亮最近使用的其他标签，循环选择。
- 当前窗口只有一个标签时不切换。
- 首版不支持无痕窗口。

## 已确认的实现边界

- 首版要求 Chrome 127+，保留既有最低版本约定。
- 每轮以 Chrome 提供的 lastAccessed 建立初始顺序，无需维护第二份历史。时间相同或缺失时以标签栏顺序稳定排序，不宣称能精确还原重启前顺序。
- 默认 ⌘X 优先保证松键体验；自定义为不含 Command 或 Option 的组合时使用 Enter 或点击确认，首版不泛化所有修饰键释放语义。
- 没有观察到释放事件时，不靠超时猜测确认；保留面板等待 Enter 或点击。独立小窗口也监听修饰键释放；监听器建立前已发生的释放无法追溯，Enter/点击作为兜底。
- 数据仅在本机处理，不设置账户、服务端或遥测，不保存网页正文；缩略图保存在本机临时会话缓存，退出浏览器清空。

## 实现前技术验证

- 先验证 commands 与网页键盘事件配合，覆盖快速轻按、持续循环、Shift 反向、输入框焦点和失焦取消。
- 尽早监听释放事件，避免等待服务工作线程或界面加载时丢失快速轻按操作。
- 若验证无法满足已确认核心体验，反馈具体限制后重新讨论；不静默替换交互。
- 完成代码后创建子代理审查；通过后创建 PR，再依据审查风险决定自动合并或请求人类审查。用户已授权创建公开仓库 redisread/switch-tab。

## 已核实的约束

- Chrome commands 支持的快捷键不含 Tab，不能承诺覆盖原生 Control+Tab。
- commands 仅提供命令触发事件，松键确认需要界面键盘事件及实际验证。
- 页面浮层无法注入 chrome:// 等受限页面；独立扩展窗口提供居中入口。

参考：[commands](https://developer.chrome.com/docs/extensions/reference/api/commands)、[action](https://developer.chrome.com/docs/extensions/reference/api/action)、[popup](https://developer.chrome.com/docs/extensions/develop/ui/add-popup)。

补充：[tabs.lastAccessed](https://developer.chrome.com/docs/extensions/reference/api/tabs)、[storage.session](https://developer.chrome.com/docs/extensions/reference/api/storage)、[无痕模式](https://developer.chrome.com/docs/extensions/reference/manifest/incognito)。

## 0.2 UI 与缩略图

- 用户将默认快捷键改为 ⌘X，反向 ⌘⇧X；支持 Command/Option 松键确认。
- 参照 Arc 的预览在上、图标标题在下的横向卡片，选中状态使用填充和边框。空间不足时水平滚动，选择项自动进入视口。
- 普通网页在激活、加载完成或滚动结束后采集可见区域；不会为补齐预览激活其他标签。
- 缩略图压缩到最多 480px 宽，最多 20 张且内存预算约 4MB，仅使用 storage.session；关闭/导航/跨窗口移动时失效。
- captureVisibleTab 需要新增 `<all_urls>` 主机权限；实际仅采集 HTTP/HTTPS，不采集无痕或内部页面。
- UI 参考：[Arc 切换器截图](https://allthings.how/how-to-jump-back-to-last-tab-in-arc-browser/)。

## 已确认修订：统一居中与松键确认

- 用户确认普通网页继续使用居中浮层，受限页面和地址栏焦点场景改用相对来源窗口居中的独立小窗口。
- 移除 action.default_popup；点击工具栏图标也使用居中窗口，但没有按键持有时用 Enter/点击确认。
- 松开 Command 确认，松开 X 仅结束一次循环按键。
- 来源 tabId/windowId 固定，不能将独立切换窗口当成候选来源。
- 新窗口创建后按实际窗口尺寸重新居中，适配系统最小尺寸；操作系统可能限制部分屏外窗口的位置。
- 选择状态保存在会话中；界面加载期间观察到的松键会保留，数据就绪后确认。
- Esc 取消并返回来源窗口，失焦取消且不抢回焦点。确认前校验会话令牌、来源标签和独立窗口身份。

## 0.3.2 缩略图恢复

- 已有页面缺少内容脚本时，通过 `scripting.executeScript` 在隔离环境补齐，监听器幂等安装，无需刷新或自动切换后台标签。
- 激活、页面完成加载、回到浏览器窗口、页面重新获得焦点时触发采集；200ms 后首次尝试，失败最多重试两次、间隔 750ms，保留每 650ms 最多一次的节流。
- 后台标签发出的过期 preview-request 不得覆盖前台采集任务。新请求替换旧任务时，旧任务不再重试。
- 所有尝试仍校验非无痕 HTTP/HTTPS、当前活动标签和窗口焦点，并在截图前后验证页面 URL、会话 epoch 与导航版本。未访问页面不伪造缩略图。
