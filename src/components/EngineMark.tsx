import type { Engine } from "../../shared/types";
// Official logos you added in src/assets/brands.
import claudeLogo from "@/assets/brands/claude.svg";
import codexLogo from "@/assets/brands/codex.svg";
import copilotLogo from "@/assets/brands/github-copilot.svg";
import copilotLogoWhite from "@/assets/brands/github-copilot-white-icon.svg";
import githubLogo from "@/assets/brands/github-icon-dark.svg";
import githubLogoWhite from "@/assets/brands/github-white.svg";
import chatgptLogo from "@/assets/brands/chatgpt.svg";
import figmaLogo from "@/assets/brands/figma-icon.svg";
import azureDevOpsLogo from "@/assets/brands/azure-devops.svg";
import azureLogo from "@/assets/brands/azure.svg";

export type Brand = Engine | "github" | "chatgpt" | "figma" | "azure-devops" | "azure";
const logos: Record<Brand, { light: string; dark: string }> = {
  claude: { light: claudeLogo, dark: claudeLogo },
  codex: { light: codexLogo, dark: codexLogo },
  copilot: { light: copilotLogo, dark: copilotLogoWhite },
  github: { light: githubLogo, dark: githubLogoWhite },
  chatgpt: { light: chatgptLogo, dark: chatgptLogo },
  figma: { light: figmaLogo, dark: figmaLogo },
  "azure-devops": { light: azureDevOpsLogo, dark: azureDevOpsLogo },
  azure: { light: azureLogo, dark: azureLogo },
};

/**
 * A brand logo that follows the theme (dark logos on light backgrounds and
 * white ones on dark). `onDark` forces the white version, for dark tiles.
 */
export function BrandLogo({ brand, size = 24, onDark = false }: { brand: Brand; size?: number; onDark?: boolean }) {
  const logo = logos[brand];
  if (onDark || logo.light === logo.dark)
    return <img src={onDark ? logo.dark : logo.light} alt="" width={size} height={size} className="brand-logo" />;
  return (
    <>
      <img src={logo.light} alt="" width={size} height={size} className="brand-logo logo-light" />
      <img src={logo.dark} alt="" width={size} height={size} className="brand-logo logo-dark" />
    </>
  );
}

export function EngineMark({ engine, size = 24 }: { engine: Engine; size?: number }) {
  return <BrandLogo brand={engine} size={size} />;
}
