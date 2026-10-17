import type { Metadata, Viewport } from "next";
import { Chakra_Petch, DM_Sans, Geist_Mono } from "next/font/google";
import { PwaRegistration } from "@/components/PwaRegistration";
import { QueryProvider } from "@/lib/query-provider";
import "katex/dist/katex.min.css";
import "./globals.css";

const dmSans = DM_Sans({
	subsets: ["latin"],
	variable: "--font-dm-sans",
	display: "swap",
});

const chakraPetch = Chakra_Petch({
	subsets: ["latin"],
	weight: ["500", "600", "700"],
	variable: "--font-chakra-petch",
	display: "swap",
});

const geistMono = Geist_Mono({
	subsets: ["latin"],
	variable: "--font-geist-mono",
	display: "swap",
});

export const metadata: Metadata = {
	title: "zosma.ai",
	description: "zosma.ai interface for the Pi coding agent",
	applicationName: "zosma.ai",
	manifest: "/manifest.webmanifest",
	icons: {
		icon: [
			{
				url: "/favicon.ico",
				type: "image/x-icon",
			},
		],
		apple: [
			{
				url: "/icons/apple-touch-icon.png",
				sizes: "180x180",
				type: "image/png",
			},
		],
	},
	appleWebApp: {
		capable: true,
		statusBarStyle: "black-translucent",
		title: "zosma.ai",
	},
	formatDetection: {
		telephone: false,
	},
};

export const viewport: Viewport = {
	width: "device-width",
	initialScale: 1,
	viewportFit: "cover",
	interactiveWidget: "resizes-content",
	themeColor: [
		{ media: "(prefers-color-scheme: light)", color: "#ffffff" },
		{ media: "(prefers-color-scheme: dark)", color: "#151517" },
	],
};

export default function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html
			lang="en"
			translate="no"
			className={`${dmSans.variable} ${chakraPetch.variable} ${geistMono.variable} notranslate`}
			suppressHydrationWarning
		>
			<head>
				<meta name="google" content="notranslate" />
				<script
					dangerouslySetInnerHTML={{
						__html: `(function(){try{var t=localStorage.getItem("pi-theme");var dark=t==="dark"||((t==null||t===""||t==="auto")&&window.matchMedia("(prefers-color-scheme: dark)").matches);if(dark)document.documentElement.classList.add("dark")}catch(e){}})();`,
					}}
				/>
			</head>
			<body translate="no" className="notranslate" suppressHydrationWarning>
				<QueryProvider>{children}</QueryProvider>
				<PwaRegistration />
			</body>
		</html>
	);
}
