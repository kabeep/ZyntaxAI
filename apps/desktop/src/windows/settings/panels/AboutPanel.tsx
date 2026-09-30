import { useEffect, useState, type ComponentType } from "react";
import { ArrowUpRight, Boxes, Download, Github, Scale, User } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button, Dialog, SettingGroup, SettingRow } from "@/components/ui";
import logo from "@/assets/logo.png";
import licenceText from "../../../../../../LICENSE?raw";
import forkNotice from "../../../../../../NOTICE?raw";
import { cn } from "@/lib/cn";
import { ipc, type AppPaths } from "@/lib/ipc";
import { useAppStore } from "@/store/useAppStore";

const LINKS = [
  {
    icon: Download,
    title: "Download",
    subtitle: "github.com/kabeep/ZyntaxAI/releases",
    href: "https://github.com/kabeep/ZyntaxAI/releases",
    featured: true,
  },
  {
    icon: Github,
    title: "Source code",
    subtitle: "github.com/kabeep/ZyntaxAI",
    href: "https://github.com/kabeep/ZyntaxAI",
  },
  {
    icon: Boxes,
    title: "Original project",
    subtitle: "github.com/TheHolyOneZ/ZyntaxAI",
    href: "https://github.com/TheHolyOneZ/ZyntaxAI",
  },
  {
    icon: User,
    title: "Original author",
    subtitle: "TheHolyOneZ",
    href: "https://github.com/TheHolyOneZ",
  },
] satisfies {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  href: string;
  featured?: boolean;
}[];

export function AboutPanel() {
  const version = useAppStore((state) => state.version);
  const backend = useAppStore((state) => state.secretBackend);
  const [showLicence, setShowLicence] = useState(false);
  const [paths, setPaths] = useState<AppPaths | null>(null);

  useEffect(() => {
    void ipc.getPaths().then(setPaths);
  }, []);

  return (
    <div className="scroll-area h-full">
      <div className="mx-auto max-w-2xl px-8 py-7">
        <header className="mb-9 flex items-center gap-5">
          <Mark className="size-16 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-xl leading-none font-medium tracking-tight text-fg">ZyntaxAI</h1>
              <span className="rounded border border-line px-1.5 py-0.5 text-2xs text-muted">
                Fork
              </span>
            </div>
            <p className="mt-1.5 text-sm text-muted">
              Correct, rewrite and translate text anywhere, with one hotkey.
            </p>
            <p className="mt-1.5 text-xs text-muted">
              Based on ZyntaxAI by TheHolyOneZ. This fork is maintained by kabeep.
            </p>
            <p data-numeric className="mt-2 text-2xs text-faint">
              Version {version || "—"} &middot; Windows, Linux and macOS
            </p>
          </div>
        </header>

        <div className="mb-9 grid grid-cols-2 gap-3">
          {LINKS.map((link) => (
            <LinkCard key={link.href} {...link} />
          ))}
        </div>

        <SettingGroup title="Licence">
          <div className="flex items-start gap-3 px-4 py-3.5">
            <Scale className="mt-0.5 size-4 shrink-0 text-faint" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg">
                GNU General Public License v3.0 or later
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                You are free to use, study, share and modify ZyntaxAI. If you distribute it —
                changed or not — you must pass on those same freedoms and make your source available
                under the same licence.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted">
                This software is provided without warranty, to the extent permitted by law. See the
                licence for the full terms.
              </p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => setShowLicence(true)}
              >
                View licence
              </Button>
            </div>
          </div>
        </SettingGroup>

        <SettingGroup
          title="Your data"
          description="Corrected text is never written to disk. Only counts and token totals are stored."
        >
          <SettingRow
            label="API keys"
            description={
              backend === "keychain"
                ? "Stored in your system keychain, never in a config file."
                : backend === "encryptedFile"
                  ? "No system keychain was found, so keys are in an encrypted file in the data directory below."
                  : "—"
            }
            control={null}
          />
          <PathRow label="Settings" value={paths?.config} />
          <PathRow label="History and logs" value={paths?.data} />
        </SettingGroup>

        <p className="pt-2 text-center text-2xs text-faint">
          Built with Rust, Tauri and React &middot; &copy; 2026 TheHolyOneZ
        </p>
        <p className="mt-1 text-center text-2xs text-faint">Fork maintained by kabeep.</p>
        <Dialog
          open={showLicence}
          onOpenChange={setShowLicence}
          title="GNU General Public License"
          description="Version 3; this project is licensed under GPL v3.0 or later."
          width="lg"
          footer={
            <Button variant="secondary" onClick={() => setShowLicence(false)}>
              Close licence
            </Button>
          }
        >
          <pre
            data-selectable
            className="mb-4 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted"
          >
            {forkNotice}
          </pre>
          <pre
            data-selectable
            className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted"
          >
            {licenceText}
          </pre>
        </Dialog>
      </div>
    </div>
  );
}

function LinkCard({
  icon: Icon,
  title,
  subtitle,
  href,
  featured,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  href: string;
  featured?: boolean;
}) {
  return (
    <button
      onClick={() => void openUrl(href)}
      className={cn(
        "group relative flex flex-col items-start gap-2.5 rounded-lg border p-4 text-left",
        "transition-colors duration-fast ease-out",
        featured
          ? "border-accent-border bg-accent-subtle hover:border-accent"
          : "border-line-subtle bg-surface hover:border-line-strong hover:bg-hover/40",
      )}
    >
      <Icon className={cn("size-5", featured ? "text-accent" : "text-muted")} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-fg">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">{subtitle}</span>
      </span>
      <ArrowUpRight
        className={cn(
          "absolute top-3.5 right-3.5 size-3.5 text-faint",
          "opacity-0 transition-opacity duration-fast group-hover:opacity-100",
        )}
      />
    </button>
  );
}

function PathRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <SettingRow
      label={label}
      stacked
      control={
        <code
          data-selectable
          className="block truncate rounded-md bg-inset px-2.5 py-1.5 font-mono text-xs text-muted"
          title={value}
        >
          {value ?? "…"}
        </code>
      }
    />
  );
}

function Mark({ className }: { className?: string }) {
  return <img src={logo} alt="" className={cn("rounded-xl", className)} />;
}
