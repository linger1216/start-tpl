import { createFormHookContexts } from "@tanstack/react-form";

/**
 * TanStack Form 的字段 / 表单上下文。
 *
 * `createFormHook`(见 `#/hooks/demo.form`)靠这两个 context 把 `useFieldContext`
 * 与 `useFormContext` 注入到字段组件和表单组件里,这样字段 / 表单组件就不需要调用方手工传 field/form 实例。
 */
export const { fieldContext, useFieldContext, formContext, useFormContext } = createFormHookContexts();
