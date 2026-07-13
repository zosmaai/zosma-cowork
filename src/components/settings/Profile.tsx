/**
 * Profile — "My Profile" settings section.
 *
 * Shows the signed-in Google account: avatar (or initials fallback),
 * name, email, verification status, and account age.
 * Data comes entirely from the Better Auth session — no extra network call.
 */
import type { ZosmaUser } from "@/types/auth";
import { BadgeCheck, Calendar, Mail } from "lucide-react";

/** Google coloured logo — matches LoginScreen exactly. */
const GoogleLogo = ({ className }: { className?: string }) => (
	<svg className={className} viewBox="0 0 24 24" aria-hidden="true">
		<path
			d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
			fill="#4285F4"
		/>
		<path
			d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
			fill="#34A853"
		/>
		<path
			d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
			fill="#FBBC05"
		/>
		<path
			d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
			fill="#EA4335"
		/>
	</svg>
);

function formatMemberSince(date: Date): string {
	return new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
		new Date(date),
	);
}

/** Derives up-to-2 initials from a display name. */
function initials(name: string): string {
	const parts = name.trim().split(/\s+/);
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface ProfileProps {
	user: ZosmaUser;
}

export function Profile({ user }: ProfileProps) {
	const letters = user.name ? initials(user.name) : user.email[0].toUpperCase();

	return (
		<section className="space-y-5">
			<div>
				<h2 className="text-sm font-semibold text-foreground mb-1">My Profile</h2>
				<p className="text-xs text-muted-foreground">
					Your Zosma account — signed in via Google.
				</p>
			</div>

			{/* ── Avatar + name card ── */}
			<div className="glass overflow-hidden">
				<div className="px-5 py-5 flex items-center gap-4">
					{/* Avatar — Google profile pic or branded initials */}
					{user.image ? (
						<img
							src={user.image}
							alt={user.name ?? user.email}
							className="w-14 h-14 rounded-2xl object-cover shrink-0 ring-2 ring-border"
							referrerPolicy="no-referrer"
						/>
					) : (
						<div className="w-14 h-14 rounded-2xl shrink-0 flex items-center justify-center text-lg font-semibold select-none bg-primary/12 text-primary">
							{letters}
						</div>
					)}

					{/* Name / email */}
					<div className="flex-1 min-w-0">
						{user.name && (
							<div className="text-[15px] font-semibold text-foreground truncate leading-tight mb-0.5">
								{user.name}
							</div>
						)}
						<div className="flex items-center gap-1.5 min-w-0">
							<span className="text-[13px] text-muted-foreground truncate">{user.email}</span>
							{user.emailVerified && (
								<BadgeCheck
									className="w-3.5 h-3.5 shrink-0 text-primary"
									aria-label="Email verified"
								/>
							)}
						</div>
					</div>

					{/* "Signed in with Google" pill */}
					<div className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted/60">
						<GoogleLogo className="w-3.5 h-3.5" />
						<span className="text-[11px] font-medium text-muted-foreground">Google</span>
					</div>
				</div>
			</div>

			{/* ── Detail rows ── */}
			<div className="glass overflow-hidden divide-y divide-border/60">
				<DetailRow
					icon={<Mail className="w-3.5 h-3.5" />}
					label="Email"
					value={user.email}
					badge={
						user.emailVerified ? (
							<span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-primary/12 text-primary">
								Verified
							</span>
						) : (
							<span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
								Unverified
							</span>
						)
					}
				/>
				<DetailRow
					icon={<Calendar className="w-3.5 h-3.5" />}
					label="Member since"
					value={formatMemberSince(user.createdAt)}
				/>
			</div>
		</section>
	);
}

function DetailRow({
	icon,
	label,
	value,
	badge,
}: {
	icon: React.ReactNode;
	label: string;
	value: string;
	badge?: React.ReactNode;
}) {
	return (
		<div className="px-4 py-3 flex items-center gap-3">
			<span className="text-muted-foreground shrink-0">{icon}</span>
			<div className="flex-1 min-w-0">
				<div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">
					{label}
				</div>
				<div className="text-[13px] text-foreground truncate">{value}</div>
			</div>
			{badge && <div className="shrink-0">{badge}</div>}
		</div>
	);
}
