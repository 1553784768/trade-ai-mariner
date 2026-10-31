"use client";
import { t } from "@/i18n/runtime";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiFailure, type Schema } from "@/lib/api";
import { PrimaryButton } from "./ui";
export function ImportDialog({ close }: { close: () => void }) {
  const [file, setFile] = useState<File | null>(null),
    cache = useQueryClient();
  const upload = useMutation({
    mutationFn: () => {
      const body = new FormData();
      body.append("file", file!);
      return api<Schema<"ImportResult">>("/orders/import", { method: "POST", body });
    },
    onSuccess: () => cache.invalidateQueries(),
  });
  const errors =
    upload.error instanceof ApiFailure && Array.isArray(upload.error.details)
      ? (upload.error.details as { row: number; field: string; message: string }[])
      : [];
  return (
    <div className="overlay">
      <section role="dialog" aria-modal="true" aria-labelledby="import-title" className="modal">
        <h2 id="import-title" className="modal-head">
          {t("导入订单 CSV")}
        </h2>
        <div className="modal-body">
          <label className="field">
            {t("选择文件")}
            <input
              className="input"
              type="file"
              accept=".csv"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
          {upload.error && (
            <div className="banner bad" role="alert">
              {t("文件未导入，请修正以下错误")}
            </div>
          )}
          {errors.map((e, i) => (
            <p key={i} style={{ fontSize: 12, color: "var(--color-bad)" }}>
              {t("第")}
              {e.row} {t("行 ·")}
              {e.field} · {e.message}
            </p>
          ))}
          {upload.data && (
            <p className="banner info">
              {t("已导入")}
              {upload.data.imported}
              {t("行，更新")}
              {upload.data.updated}
              {t("行")}
            </p>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={close}>
            {t("取消")}
          </button>
          <PrimaryButton disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
            {t("上传")}
          </PrimaryButton>
        </div>
      </section>
    </div>
  );
}
