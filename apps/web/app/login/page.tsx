"use client";

import { useRouter } from "next/navigation";
import { LoginScreen } from "@/components/LoginScreen";
import { I18nProvider } from "@/hooks/useI18n";

export default function LoginPage() {
  const router = useRouter();

  return (
    <I18nProvider>
      <LoginScreen onSignedIn={() => router.replace("/")} />
    </I18nProvider>
  );
}
