import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "#/components/layout/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { useAppForm } from "#/hooks/demo.form";

export const Route = createFileRoute("/(main)/demo/form/address")({
	component: AddressForm,
});

const COUNTRIES = [
	{ label: "United States", value: "US" },
	{ label: "Canada", value: "CA" },
	{ label: "United Kingdom", value: "UK" },
	{ label: "Australia", value: "AU" },
	{ label: "Germany", value: "DE" },
	{ label: "Japan", value: "JP" },
];

/**
 * 字段级校验:同一个检查函数同时挂到 `onBlur` 与 `onSubmit`,
 * 这样失焦会立刻提示,直接点提交也不会漏掉空字段。
 */
const fieldRules = (check: (value: string) => string | undefined) => ({
	onBlur: ({ value }: { value: string }) => check(value),
	onSubmit: ({ value }: { value: string }) => check(value),
});

const required = (message: string) => fieldRules((value) => (value.trim() === "" ? message : undefined));

const emailRule = fieldRules((value) => {
	if (value.trim() === "") return "Email is required";
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? undefined : "Invalid email address";
});

function AddressForm() {
	const form = useAppForm({
		defaultValues: {
			fullName: "",
			email: "",
			// 嵌套对象:字段名用点号路径寻址(address.city / address.country)。
			address: {
				city: "",
				country: "",
			},
		},
		onSubmit: ({ value }) => {
			console.log("form.address submitted", value);
			alert("Form submitted successfully!");
		},
	});

	return (
		<main className="mx-auto w-full max-w-2xl px-4 py-8">
			<PageHeader
				title="Address Form"
				description="Nested field paths, per-field validation and the Select primitive."
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
						<CardTitle>Contact</CardTitle>
						<CardDescription>Flat string fields with their own validators.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<form.AppField name="fullName" validators={required("Full name is required")}>
							{(field) => <field.TextField label="Full name" placeholder="Ada Lovelace" />}
						</form.AppField>
						<form.AppField name="email" validators={emailRule}>
							{(field) => <field.TextField label="Email" type="email" placeholder="ada@example.com" />}
						</form.AppField>
					</CardContent>
				</Card>

				<Card>
					<CardHeader>
						<CardTitle>Address</CardTitle>
						<CardDescription>Nested address.* paths — a text field plus a Select.</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<form.AppField name="address.city" validators={required("City is required")}>
							{(field) => <field.TextField label="City" placeholder="London" />}
						</form.AppField>
						<form.AppField name="address.country" validators={required("Country is required")}>
							{(field) => <field.Select label="Country" placeholder="Select a country" values={COUNTRIES} />}
						</form.AppField>
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
