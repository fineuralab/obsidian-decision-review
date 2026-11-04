# 首版数据设计

这是 0.1.x 使用的文件格式，0.1.6 继续兼容已有记录。结构版本为 `1`。实现位于 `src/domain.ts`、`src/codec.ts` 和 `src/store.ts`。

## 文件布局

```text
决策复盘/
  决策-<稳定 ID>.md
  经验/
    经验-<决策 ID>-<回访 ID>.md
  演示数据/
    决策-demo-<ID>.md
    经验/...
```

默认数据目录为「决策复盘」，新库英文环境可默认 `Decision Review`。选定后切语言不改路径。每个决定一篇文件，以 YAML 属性为结构化源数据、正文为可阅读投影；保留 `<!-- decision-review:notes -->` 以下自由笔记。独立经验文件以正文为用户内容，生成后不被自动重写。

## 核心结构

```ts
type LocalDate = string; // 严格有效的 YYYY-MM-DD；不以 UTC 截断转换
type Instant = string;   // 带 Z / 时区偏移的 ISO 8601 时间点
type Reference =
  | { kind: 'file'; path: string; label?: string }
  | { kind: 'url'; url: string; label?: string };

type RecordSnapshot = {
  title: string;
  decisionDate: LocalDate;
  reason: string;
  expected: string;
  alternatives?: string;
  assumption?: string;
  references: Reference[];
};

type Revision = {
  id: string;
  createdAt: Instant;
  explanation: string;
  record: RecordSnapshot;
};

type Review = {
  id: string;
  createdAt: Instant;
  reviewDate: LocalDate;
  recordRevisionId: string;
  actual: string;
  outcome: 'met' | 'partial' | 'unmet' | 'unclear';
  reflection?: string;
  lesson?: string;
  references: Reference[];
  followup: 'scheduled' | 'unscheduled' | 'closed';
  nextReviewDate: LocalDate | null;
};

type Supplement = {
  id: string;
  createdAt: Instant;
  text: string;
  references: Reference[];
};

type ScheduleEvent = {
  id: string;
  createdAt: Instant;
  nextReviewDate: LocalDate | null;
  status: 'open' | 'closed';
  reason?: string;
};

type ReviewCorrection = {
  id: string;
  createdAt: Instant;
  reviewId: string;
  explanation: string;
  corrected: Review; // Review.id 不变，原版本留在 reviews，回访去向不允许在此更正
};

type DecisionFile = {
  decisionReview: 1;
  id: string;
  demo: boolean;
  createdAt: Instant;
  updatedAt: Instant;
  original: Revision;
  revisions: Revision[];
  reviews: Review[];
  reviewCorrections: ReviewCorrection[];
  supplements: Supplement[];
  schedules: ScheduleEvent[];
  lessonLinks: {
    reviewId: string;
    path: string;
    reviewVersionId: string; // 首次用回访 ID，更正后用 correction ID
  }[];
};
```

`original` 永不由应用覆盖；更正追加完整修订。默认展示最初版本，可切换查看修订。每次回访明确关联使用的版本，不能引用不存在的版本。

最新安排由 `schedules` 和回访的创建时间合并还原；回访的 `followup` 与 `nextReviewDate` 一起生效。创建时必须有一个安排事件，即使日期为空。全部时间点排序按实际 UTC 时间进行，时间相同时用稳定 ID 决定次序；应用生成时确保单文件事件时间单调递增。补记的 `reviewDate` 只用于历史显示，不回溯改变最新安排。

回访的 `outcome` 和 `followup` 必须为规定的字符串枚举，不接受列表或对象的字符串转换结果。更正回访按 `reviewId` 应用最近修订，原文仍保留。更正不得改变回访的原始创建时间、ID、后续安排或所参照记录版本；如需改安排，单独生成安排事件。更正后的发生日期可以晚于历史安排日期，历史计划仍原样保留。经验文件不因回访更正而静默重写，提示用户查看源记录后自行修订。

`status`、`nextReviewDate` 是内存投影，不再重复存成顶层可变真值。单次操作将完整事件及投影正文一次写入同一文件，避免状态与历史分步保存。

不记录结构化置信度百分比。自然语言预期不适合直接用于概率校准；后续若新增概率预测，应采用独立、可判定结果的预测条目。

## 经验文件与跨文件失败

经验笔记带 `decisionReviewLesson: 1`、稳定 `decisionId`、`reviewId`、`reviewVersionId` 和原决定 wiki 链接。先写经验文件，成功后再向源决定写入 `lessonLinks`。第二步失败时保留经验文件，明确提示「经验已保存，来源索引更新失败」，重试使用同一 ID / 目标，不再新建副本。

加载时扫描经验目录的来源 ID，可从已存在的经验文件重建关联。文件已存在时打开原文件。用户选择另存副本时才生成新 ID 与路径。经验正文由用户自由编辑，不在重建时覆盖。

## 文件读写与边界

- 通过 Obsidian Vault API 读取和写入；库内路径归一化，拒绝越出库根目录的路径。数据目录和插件写入路径不允许点号开头的隐藏路径段。父目录及新文件需要出现在宿主索引中；已有但尚未被索引的目录会明确报错，不返回空列表冒充成功。
- 旧配置或运行中的数据目录进入不可用路径时，持续显示实际路径和恢复提示，暂停写入；有旧快照时保留并禁写。选择有效可见目录后解除保护，不自动搬动或删除源文件。普通目录名中的点号、Unicode 名称及旧引用元数据继续支持。
- 生成文件先通过同一读取解析器校验，确认结构化数据与自由笔记分隔可读，再提交写入。多行更正说明在生成正文中使用引用块，资料标签换行只在正文显示时折叠；YAML 中的原文保持不变。
- 保存前将磁盘内容与打开表单时的完整源内容比较。冲突就停止保存，保留输入并提示重开，不使用 `updatedAt` 单独判断。
- 读取校验版本、日期、必填字段、枚举、ID、引用与事件完整性。格式异常、重复 ID、未来结构版本、自由笔记标记丢失时，列出具体文件并禁写该文件。
- 工作会话内可显示最后一次成功解析的旧快照，必须标注「数据待修复，暂显示上次内容」，不允许从旧快照覆盖源文件。首次启动无快照则排除异常项，提示不消失。
- 数据目录改名事件串行处理，设置写入或引用更新期间发生的后续移动会重新核对实际路径。目录变更立即使旧操作上下文失效；排队及正在读取的旧请求在写入或移到回收站前再次检查，表单保留输入。设置持久化暂时失败时先跟随实际目录并重试；持续失败会提示重新保存目录。
- 插件停用时关闭旧存储实例，使旧表单和排队请求失效；读取完成后、提交写入前再次检查。重新启用不会恢复旧实例的写权限。已经交给宿主的文件 I/O 允许完成，不做撤销或删除补偿；尚未提交的后续写入停止。
- 设置持久化在同一笔记库的插件实例之间串行执行，新实例启动前等待已发出的设置写入完成。停用实例不得发起新设置写入、重新注册命令或更新当前界面。打开插件面板或笔记前等待宿主工作区就绪，并再次核对实例仍有效。
- 笔记重命名或移动时，更新当前和历史里的结构化文件路径，再重新生成 wiki 链接。文本快照保持原语义；自由文本内普通链接由 Obsidian 自身链接机制处理。
- 目标删除后保留路径和标签，标注链接失效；不自动删除决策、回访或经验。插件关闭期间的移动无法可靠推断，保留提示供重新关联。
- 日期以本地自然日比较。+30 天用日历日加法，覆盖月末、闰年和夏令时，不使用固定毫秒数。
- URLs 只接受 HTTP(S)，不后台请求、不远程嵌图；打开交给宿主，显示文字不作为 HTML 注入。
- 决定删除走库内回收站确认。清除演示只处理 `demo: true` 且位于演示目录的决策和带对应来源标记的演示经验；不清理用户自行放入的其他文件。

## 可读正文

正文包含：决定、理由、预期、其他选项、假设、资料、记录修订、全部回访、安排变更与补充、经验链接。没有内容的选填栏目省略。日期展示跟随界面语言，结构化日期不改。

示例见 [演示决策](../demo/决策-demo-plugin-direction.md)。这是一份格式示例，和交互原型的浏览器存储无关。原型为了评审只实现简化的记录、回访和经验数据，不能直接当成正式文件解析器。
