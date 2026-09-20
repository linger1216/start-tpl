import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { PageHeader } from "#/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { useAppForm } from "#/hooks/demo.form";

export const Route = createFileRoute("/(main)/demo/form/simple")({
	component: SimpleForm,
});

/**
 * 表单级校验:整个表单共用一个 zod schema。
 * TanStack Form 支持标准 schema,校验失败时错误会按字段路径自动分发到各字段。
 */
const schema = z.object({
	title: z.string().min(1, "Title is required"),
	description: z.string().min(1, "Description is required"),
	priority: z.number().min(0).max(100),
	published: z.boolean(),
});

function SimpleForm() {
	const form = useAppForm({
		defaultValues: {
			title: "",
			description: "",
			priority: 50,
			published: false,
		},
		validators: {
			onBlur: schema,
			onSubmit: schema,
		},
		onSubmit: ({ value }) => {
			console.log("form.simple submitted", value);
			alert("Form submitted successfully!");
		},
	});

	return (
		<main className="mx-auto w-full max-w-2xl px-4 py-8">
			<PageHeader
				title="Simple Form"
				description="TanStack Form wired to the template's UI primitives through createFormHook."
			/>

			<form
				onSubmit={(event) => {
					event.preventDefault();
					event.stopPropagation();
					form.handleSubmit();
				}}
				className="mt-5 space-y-5"
			>
				<Card>
					<CardHeader>
						<CardTitle>Basics</CardTitle>
						<CardDescription>String and multiline fields, validated by one shared zod schema.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<form.AppField name="title">
							{(field) => <field.TextField label="Title" placeholder="e.g. Release notes" />}
						</form.AppField>
						<form.AppField name="description">
							{(field) => <field.TextArea label="Description" placeholder="What changed?" />}
						</form.AppField>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Publishing</CardTitle>
						<CardDescription>Number and boolean fields backed by the Slider and Switch primitives.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<form.AppField name="priority">{(field) => <field.Slider label="Priority" />}</form.AppField>
						<form.AppField name="published">{(field) => <field.Switch label="Publish immediately" />}</form.AppField>
					</CardContent>
				</Card>

				<div className="flex justify-end">
					<form.AppForm>
						<form.SubscribeButton label="Submit" />
					</form.AppForm>
				</div>
			</form>
		</main>
	);
}
