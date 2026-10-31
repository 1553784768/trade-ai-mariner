"use client";
import Link from "next/link";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { t } from "@/i18n/runtime";
import { tradeApi, jsonBody } from "@/lib/api";
import type { Library, DocumentFile, DocumentText, Template } from "@/lib/trade-types";
import { Shell } from "./shell";
import {
  Field,
  Modal,
  ListDetail,
  SelectCard,
  QueryState,
  Blank,
  FileButton,
  useAction,
  useTradeQuery,
  useSelection,
  useToast,
} from "./trade-ui";

function Templates() {
  const query = useTradeQuery<Template[]>("/templates"),
    [id, setId] = useSelection("tpl"),
    action = useAction(),
    toast = useToast();
  const [editor, setEditor] = useState<Template | "new" | null>(null),
    [rendered, setRendered] = useState("");
  const selected = query.data?.find((v) => String(v.id) === id) || query.data?.[0];
  return (
    <>
      <div className="toolbar">
        <button className="btn btn-primary" onClick={() => setEditor("new")}>
          {t("新建模板")}
        </button>
      </div>
      <QueryState query={query} />
      <ListDetail
        list={query.data?.map((v) => (
          <SelectCard
            key={v.id}
            active={selected?.id === v.id}
            title={v.name}
            onClick={() => {
              setId(v.id);
              setRendered("");
            }}
          />
        ))}
      >
        {selected ? (
          <>
            <h2>{selected.name}</h2>
            <div className="toolbar">
              <button className="btn" onClick={() => setEditor(selected)}>
                {t("编辑")}
              </button>
              <button
                className="btn"
                onClick={() => {
                  if (confirm(t("确定删除“{name}”？", { name: selected.name })))
                    void action.run(
                      () => tradeApi(`/templates/${selected.id}`, jsonBody("DELETE")),
                      "模板已删除",
                      () => setId(""),
                    );
                }}
              >
                {t("删除")}
              </button>
            </div>
            <pre className="trade-preview">{selected.content}</pre>
            <h3>{t("填写模板变量")}</h3>
            <form
              className="trade-form"
              onSubmit={(e) => {
                e.preventDefault();
                void action.run(
                  () =>
                    tradeApi<{ content: string }>(
                      `/templates/${selected.id}/render`,
                      jsonBody("POST", Object.fromEntries(new FormData(e.currentTarget))),
                    ),
                  "模板已生成",
                  (v) => setRendered(v.content),
                );
              }}
            >
              <div className="form-grid">
                {[
                  ["company", "公司"],
                  ["customer", "客户"],
                  ["products", "产品"],
                  ["contact", "联系人"],
                ].map(([key, label]) => (
                  <Field key={key} label={label}>
                    <input className="input" name={key} />
                  </Field>
                ))}
              </div>
              <button className="btn" disabled={action.busy}>
                {t("生成")}
              </button>
            </form>
            {rendered && (
              <>
                <pre className="trade-preview">{rendered}</pre>
                <button
                  className="btn"
                  onClick={() =>
                    navigator.clipboard
                      .writeText(rendered)
                      .then(() => toast(t("已复制")))
                      .catch(() => toast(t("复制失败，请手动复制"), true))
                  }
                >
                  {t("复制")}
                </button>
              </>
            )}
          </>
        ) : (
          <Blank />
        )}
      </ListDetail>
      {editor && (
        <Modal title={editor === "new" ? "新建模板" : "编辑模板"} onClose={() => setEditor(null)} wide>
          <form
            className="trade-form"
            onSubmit={(e) => {
              e.preventDefault();
              const values = Object.fromEntries(new FormData(e.currentTarget));
              void action.run(
                () =>
                  tradeApi<Template>(
                    editor === "new" ? "/templates" : `/templates/${editor.id}`,
                    jsonBody(editor === "new" ? "POST" : "PUT", values),
                  ),
                "模板已保存",
                (v) => {
                  setId(v.id);
                  setEditor(null);
                },
              );
            }}
          >
            <Field label="模板名称">
              <input
                className="input"
                name="name"
                defaultValue={editor === "new" ? "" : editor.name}
                required
              />
            </Field>
            <Field label="模板内容" help="支持 {{company}}、{{customer}}、{{products}}、{{contact}}">
              <textarea
                className="textarea"
                name="content"
                rows={12}
                maxLength={50000}
                defaultValue={editor === "new" ? "" : editor.content}
              />
            </Field>
            <button className="btn btn-primary" disabled={action.busy}>
              {t("保存")}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
function LibraryBrowser() {
  const libraries = useTradeQuery<Library[]>("/libraries"),
    [lib, setLib] = useSelection("lib"),
    [doc, setDoc] = useSelection("doc"),
    [open, setOpen] = useState(false),
    action = useAction();
  const library = libraries.data?.find((v) => String(v.id) === lib) || libraries.data?.[0];
  const files = useTradeQuery<DocumentFile[]>(`/libraries/${library?.id}/files`, !!library),
    selected = String(files.data?.find((v) => String(v.id) === doc)?.id || files.data?.[0]?.id || ""),
    text = useTradeQuery<DocumentText>(`/documents/${selected}/text`, !!selected);
  return (
    <>
      <div className="toolbar">
        <select
          className="select"
          aria-label={t("文档库")}
          value={library?.id || ""}
          onChange={(e) => setLib(e.target.value)}
        >
          {libraries.data?.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.file_count})
            </option>
          ))}
        </select>
        <button
          className="btn"
          disabled={!library || action.busy}
          onClick={() =>
            action.run(() => tradeApi(`/libraries/${library?.id}/scan`, jsonBody("POST")), "扫描完成")
          }
        >
          {t("扫描文件夹")}
        </button>
        {library && (
          <FileButton
            label="上传文件"
            accept=".txt,.md,.csv,.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.webp"
            onFile={(file) => {
              const data = new FormData();
              data.append("file", file);
              void action.run(
                () =>
                  tradeApi<DocumentFile>(`/libraries/${library.id}/files`, { method: "POST", body: data }),
                "文件已上传",
                (v) => setDoc(v.id),
              );
            }}
          />
        )}
        <span className="spacer" />
        <button className="btn btn-primary" onClick={() => setOpen(true)}>
          {t("新建文档库")}
        </button>
      </div>
      <QueryState query={libraries} />
      {library && (
        <p className="field-help">
          {library.description} {library.root_path}
        </p>
      )}
      <ListDetail
        list={
          <>
            {library && <QueryState query={files} />}
            {files.data?.map((v) => (
              <SelectCard
                key={v.id}
                active={selected === String(v.id)}
                title={v.filename}
                onClick={() => setDoc(v.id)}
              >
                <span>{Math.round(v.size / 1024)} KB</span>
                <span>{v.extraction_note}</span>
              </SelectCard>
            ))}
          </>
        }
      >
        {text.data ? (
          <>
            <h2>{text.data.filename}</h2>
            <div className="toolbar">
              <a className="btn" href={`/api/documents/${selected}/download`}>
                {t("下载")}
              </a>
              <Link className="btn" href={`/chat?ctx=docs&doc=${selected}`}>
                {t("文档库问答")}
              </Link>
              <button
                className="btn btn-danger-text"
                onClick={() => {
                  if (confirm(t("确定删除“{name}”？", { name: text.data!.filename })))
                    void action.run(
                      () => tradeApi(`/documents/${selected}`, jsonBody("DELETE")),
                      "文档已删除",
                      () => setDoc(""),
                    );
                }}
              >
                {t("删除")}
              </button>
            </div>
            <p className="field-help">{text.data.note}</p>
            <pre className="trade-preview">{text.data.text || t("未提取到文字")}</pre>
          </>
        ) : selected ? (
          <QueryState query={text} />
        ) : (
          <Blank />
        )}
      </ListDetail>
      {open && (
        <Modal title="新建文档库" onClose={() => setOpen(false)}>
          <form
            className="trade-form"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(
                () =>
                  tradeApi<Library>(
                    "/libraries",
                    jsonBody("POST", Object.fromEntries(new FormData(e.currentTarget))),
                  ),
                "文档库已创建",
                (v) => {
                  setLib(v.id);
                  setOpen(false);
                },
              );
            }}
          >
            {[
              ["name", "名称"],
              ["description", "说明"],
              ["root_path", "本地文件夹路径"],
            ].map(([key, label]) => (
              <Field key={key} label={label}>
                <input className="input" name={key} required={key === "name"} />
              </Field>
            ))}
            <button className="btn btn-primary" disabled={action.busy}>
              {t("创建")}
            </button>
          </form>
        </Modal>
      )}
    </>
  );
}
export function Documents() {
  const params = useSearchParams(),
    templates = params.get("mode") === "templates";
  return (
    <Shell
      title={t("文档库")}
      actions={
        <div className="segmented">
          <Link className={`btn${!templates ? " active" : ""}`} href="/documents">
            {t("文档库")}
          </Link>
          <Link className={`btn${templates ? " active" : ""}`} href="/documents?mode=templates">
            {t("单证模板")}
          </Link>
        </div>
      }
    >
      {templates ? <Templates /> : <LibraryBrowser />}
    </Shell>
  );
}
