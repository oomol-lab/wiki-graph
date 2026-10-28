[English](README.md) | 中文

# Wiki Graph Runtime

供 SDK 与服务端共用的可移植 provider 执行包。不读取环境变量，不持有凭证、存储或 Job 算法。

`ProviderRuntime` 在共同 deadline、有限传输重试和等待预算内执行完整 provider 操作。每个凭证/provider 作用域单独创建实例。`createOpenAICompletion` 缓冲完整 OpenAI-compatible SSE 候选，丢弃中断候选，并报告每次尝试可获得的用量。宿主负责注入 headers、fetch、取消信号、策略和观察回调。

`requestGuaranteedJson` 负责 JSON 修复、异步 schema/业务校验和拒答识别。只有 `ParsedJsonError` 触发业务修复；provider、取消和普通程序错误直接向上传递。请求回调第四个参数携带共同 deadline 和 signal，适配器必须转发。通过校验的空 JSON 结果仍然合法。

默认传输策略最多重试两次，使用指数退避和抖动，等待预算 60 秒，操作 deadline 360 秒。内容修复共用一个 deadline，不随候选重置。Core 保留重试次数和间隔配置，但 timeout 现在覆盖包含重试的整个请求。

POST 重试可能重复执行和计费。用量回调给出每次尝试的累计快照，宿主需去重；候选被拒绝也不能抹除已消费用量。缺失用量视为未知。

`safeErrorGraph` 输出有限深度的嵌套诊断，不包含 message、请求体和 headers。`mapConcurrent` 按有限窗口拉取任务，保留首因，等待可协作取消的兄弟任务释放资源后关闭输入。不可终止的操作必须由宿主隔离，超时本身不会释放资源。

适配和回归约束见 [runtime maintenance](../../docs/provider-runtime.md)。
