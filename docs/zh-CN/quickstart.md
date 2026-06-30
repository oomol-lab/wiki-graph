<p><a href="../en/quickstart.md">English</a> | 中文</p>

# Quick Start

本文展示 SpineDigest 的主流程：创建 `.wikg` 知识库归档，按需构建派生知识，再从这份归档中搜索、浏览、阅读和导出投影视图。

## 1. 运行要求

- Node `>=22.12.0`
- 只有构建 graph 或 summary 阶段时才需要 LLM provider 凭据

支持的 provider：

- `anthropic`
- `google`
- `openai`
- `openai-compatible`

## 2. 安装 CLI

```bash
npm install -g spinedigest
```

或无需全局安装直接运行：

```bash
npx spinedigest --help
```

## 3. 创建知识库

```bash
wikigraph wkg://book.wikg create ./book.epub
cat ./article.md | wikigraph wkg://article.wikg create --input-format markdown
```

create 会创建或替换 source 阶段的 `.wikg` 归档。此时归档已经包含规范化源数据，但还不表示已经完成 graph 构建或 summary 构建。

## 4. 查看和估算

```bash
wikigraph wkg://book.wikg/state get
wikigraph wkg://book.wikg/chapter/tree get
wikigraph wkg://book.wikg estimate --stage reading-summary
```

整份归档的 graph 或 summary 构建之前，先看 estimate。

## 5. 构建知识

```bash
wikigraph wkg://book.wikg/chapter/3 queue add --task reading-graph --accept-cost
wikigraph wkg-job://<job-id> watch --jsonl
```

如果需要 summary：

```bash
wikigraph wkg://book.wikg/chapter/3 queue add --task reading-summary --accept-cost
wikigraph wkg-job:// list --input wkg://book.wikg
```

## 6. 搜索、浏览和阅读

```bash
wikigraph wkg://book.wikg/chapter/tree get --json
wikigraph wkg://book.wikg/chunk search "central argument"
wikigraph wkg://book.wikg/chapter/3 get
wikigraph wkg://book.wikg/chunk/84 get
wikigraph wkg://book.wikg/chunk/84 related
wikigraph wkg://book.wikg/chunk/84 evidence
wikigraph wkg://book.wikg/chunk/84 pack --budget 5000
```

使用 URI lens 选择搜索对象：`<archive-uri>/chunk` 用于 Reading Graph 结构，`<archive-uri>/summary` 用于快速概览，`<archive-uri>/source` 用于原文措辞，`<archive-uri>/entity` 和 `<archive-uri>/triple` 用于 Knowledge Graph 对象。

Object command 使用 Wiki Graph URI。手动构造 URI 时，先读 `wikigraph help uri`。

输出要交给其他工具消费时，使用 `--json`。

## 7. 输出 projection

只有需要便携视图时再输出 projection。比如只需要某一章的 `.md` 文本，可以读取该章；需要完整电子书视图时再导出 EPUB：

```bash
wikigraph wkg://book.wikg/chapter/3/source get > ./chapter-3.md
wikigraph wkg://book.wikg export --output-format epub --output ./digest.epub
```

## 8. 配置 LLM 构建

运行 LLM-backed build stage 前，创建配置：

```bash
mkdir -p ~/.wikigraph

cat > ~/.wikigraph/config.json <<'JSON'
{
  "llm": {
    "provider": "openai-compatible",
    "model": "your-model",
    "baseURL": "https://your-provider.example/v1",
    "apiKey": "your-api-key"
  }
}
JSON
```

然后验证配置：

```bash
wikigraph config status
```

## 下一步

- [CLI Reference](./cli.md)
- [AI Agent Guide](./ai-agents.md)
- [Library Usage](./library.md)
