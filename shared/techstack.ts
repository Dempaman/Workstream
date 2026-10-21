/**
 * What a repository is built with, worked out from package.json and a few
 * well-known files. `icon` is a file in src/assets/tech (copied from the brand
 * icons you added); entries without an icon are shown as text.
 */
export interface TechRule {
  id: string;
  name: string;
  /** Source file in src/assets/brands, copied to src/assets/tech/<id>.svg. */
  icon?: string;
  /** npm packages in dependencies or devDependencies; a trailing "/" matches a scope prefix. */
  deps?: string[];
  /** Files or folders at the repository root; "*" matches any characters. */
  files?: string[];
}

export const techRules: TechRule[] = [
  // Languages and runtimes
  { id: "typescript", name: "TypeScript", icon: "TypeScript.svg", deps: ["typescript"], files: ["tsconfig.json"] },
  { id: "javascript", name: "JavaScript", icon: "JavaScript.svg" },
  { id: "node", name: "Node.js", icon: "Node.js.svg", files: ["package.json"] },
  { id: "dotnet", name: ".NET", icon: ".NET.svg", files: ["*.sln", "*.csproj", "global.json"] },
  { id: "csharp", name: "C#", icon: "C#-(CSharp).svg", files: ["*.csproj", "*.sln"] },
  { id: "python", name: "Python", icon: "Python.svg", files: ["pyproject.toml", "requirements.txt", "setup.py"] },
  { id: "go", name: "Go", icon: "Go.svg", files: ["go.mod"] },
  { id: "rust", name: "Rust", icon: "Rust.svg", files: ["Cargo.toml"] },
  { id: "java", name: "Java", icon: "Java.svg", files: ["pom.xml", "build.gradle", "build.gradle.kts"] },
  { id: "php", name: "PHP", icon: "PHP.svg", files: ["composer.json"] },
  { id: "ruby", name: "Ruby", icon: "Ruby.svg", files: ["Gemfile"] },
  // Frameworks
  { id: "react", name: "React", icon: "React.svg", deps: ["react"] },
  { id: "nextjs", name: "Next.js", icon: "Next.js.svg", deps: ["next"] },
  { id: "vue", name: "Vue", icon: "Vue.js.svg", deps: ["vue"] },
  { id: "nuxt", name: "Nuxt", icon: "Nuxt-JS.svg", deps: ["nuxt"] },
  { id: "angular", name: "Angular", icon: "Angular.svg", deps: ["@angular/core"] },
  { id: "svelte", name: "Svelte", icon: "Svelte.svg", deps: ["svelte"] },
  { id: "solid", name: "Solid", icon: "Solid.js.svg", deps: ["solid-js"] },
  { id: "astro", name: "Astro", icon: "Astro.svg", deps: ["astro"] },
  { id: "gatsby", name: "Gatsby", icon: "Gatsby.svg", deps: ["gatsby"] },
  { id: "qwik", name: "Qwik", icon: "Qwik.svg", deps: ["@builder.io/qwik"] },
  { id: "electron", name: "Electron", icon: "Electron.svg", deps: ["electron"] },
  { id: "tauri", name: "Tauri", icon: "Tauri.svg", deps: ["@tauri-apps/api"] },
  { id: "express", name: "Express", icon: "Express.svg", deps: ["express"] },
  { id: "fastify", name: "Fastify", icon: "Fastify.svg", deps: ["fastify"] },
  { id: "nestjs", name: "NestJS", icon: "Nest.js.svg", deps: ["@nestjs/core"] },
  { id: "jquery", name: "jQuery", icon: "jQuery.svg", deps: ["jquery"] },
  { id: "threejs", name: "Three.js", icon: "Three.js.svg", deps: ["three"] },
  { id: "d3", name: "D3", icon: "D3.js.svg", deps: ["d3"] },
  // UI and styling
  { id: "mui", name: "MUI", icon: "Material-UI.svg", deps: ["@mui/material", "@material-ui/core"] },
  { id: "antd", name: "Ant Design", icon: "Ant-Design.svg", deps: ["antd"] },
  { id: "react-bootstrap", name: "React Bootstrap", icon: "React-Bootstrap.svg", deps: ["react-bootstrap"] },
  { id: "bootstrap", name: "Bootstrap", icon: "Bootstrap.svg", deps: ["bootstrap"] },
  { id: "tailwind", name: "Tailwind CSS", icon: "Tailwind-CSS.svg", deps: ["tailwindcss"] },
  { id: "vuetify", name: "Vuetify", icon: "Veutify.svg", deps: ["vuetify"] },
  { id: "quasar", name: "Quasar", icon: "Quasar.svg", deps: ["quasar"] },
  { id: "sass", name: "Sass", icon: "Sass.svg", deps: ["sass", "node-sass", "sass-embedded"] },
  { id: "less", name: "Less", icon: "Less.js.svg", deps: ["less"] },
  { id: "postcss", name: "PostCSS", icon: "PostCSS.svg", deps: ["postcss"] },
  { id: "emotion", name: "Emotion", deps: ["@emotion/react", "@emotion/styled"] },
  // State and data
  { id: "redux", name: "Redux", icon: "Redux.svg", deps: ["redux", "@reduxjs/toolkit"] },
  { id: "mobx", name: "MobX", icon: "MobX.svg", deps: ["mobx"] },
  { id: "zustand", name: "Zustand", deps: ["zustand"] },
  { id: "tanstack-query", name: "TanStack Query", deps: ["@tanstack/react-query", "@tanstack/vue-query"] },
  { id: "react-router", name: "React Router", deps: ["react-router-dom", "react-router"] },
  { id: "graphql", name: "GraphQL", icon: "GraphQL.svg", deps: ["graphql"] },
  { id: "socketio", name: "Socket.IO", icon: "Socket.io.svg", deps: ["socket.io", "socket.io-client"] },
  { id: "firebase", name: "Firebase", icon: "Firebase.svg", deps: ["firebase"] },
  { id: "algolia", name: "Algolia", icon: "Algolia.svg", deps: ["algoliasearch"] },
  { id: "mongoose", name: "Mongoose", icon: "Mongoose.js.svg", deps: ["mongoose"] },
  { id: "sequelize", name: "Sequelize", icon: "Sequelize.svg", deps: ["sequelize"] },
  { id: "i18next", name: "i18next", deps: ["i18next"] },
  // Build
  { id: "vite", name: "Vite", icon: "Vite.js.svg", deps: ["vite"] },
  { id: "webpack", name: "webpack", icon: "Webpack.svg", deps: ["webpack"] },
  { id: "rollup", name: "Rollup", icon: "Rollup.js.svg", deps: ["rollup"] },
  { id: "babel", name: "Babel", icon: "Babel.svg", deps: ["@babel/core", "@rolldown/plugin-babel", "babel-plugin-react-compiler"] },
  // Testing
  { id: "vitest", name: "Vitest", deps: ["vitest"] },
  { id: "jest", name: "Jest", icon: "Jest.svg", deps: ["jest"] },
  { id: "playwright", name: "Playwright", icon: "Playwrite.svg", deps: ["playwright", "@playwright/test", "@vitest/browser-playwright"] },
  { id: "cypress", name: "Cypress", icon: "Cypress.svg", deps: ["cypress"] },
  { id: "storybook", name: "Storybook", icon: "Storybook.svg", deps: ["storybook", "@storybook/"] },
  { id: "mocha", name: "Mocha", icon: "Mocha.svg", deps: ["mocha"] },
  { id: "jasmine", name: "Jasmine", icon: "Jasmine.svg", deps: ["jasmine-core", "jasmine"] },
  { id: "karma", name: "Karma", icon: "Karma.svg", deps: ["karma"] },
  { id: "selenium", name: "Selenium", icon: "Selenium.svg", deps: ["selenium-webdriver"] },
  { id: "msw", name: "MSW", deps: ["msw"] },
  // Tooling
  { id: "eslint", name: "ESLint", icon: "ESLint.svg", deps: ["eslint"] },
  { id: "prettier", name: "Prettier", deps: ["prettier"] },
  { id: "npm", name: "npm", icon: "NPM.svg", files: ["package-lock.json"] },
  { id: "yarn", name: "Yarn", icon: "Yarn.svg", files: ["yarn.lock"] },
  { id: "bun", name: "Bun", icon: "Bun.svg", files: ["bun.lockb", "bun.lock"] },
  { id: "deno", name: "Deno", icon: "Deno.svg", files: ["deno.json", "deno.jsonc"] },
  // Delivery and infrastructure
  { id: "docker", name: "Docker", icon: "Docker.svg", files: ["Dockerfile", "docker-compose.yml", "docker-compose.yaml", "compose.yaml"] },
  { id: "azure-pipelines", name: "Azure Pipelines", icon: "azure-devops.svg", files: ["azure-pipelines*.yml", "azure-pipelines*.yaml"] },
  { id: "github-actions", name: "GitHub Actions", icon: "GitHub-Actions.svg", files: [".github/workflows"] },
  { id: "gitlab-ci", name: "GitLab CI", icon: "GitLab.svg", files: [".gitlab-ci.yml"] },
  { id: "kubernetes", name: "Kubernetes", icon: "Kubernetes.svg", files: ["k8s", "kubernetes"] },
  { id: "helm", name: "Helm", icon: "Helm.svg", files: ["Chart.yaml", "charts"] },
  { id: "terraform", name: "Terraform", icon: "HashiCorp-Terraform.svg", files: ["*.tf", "terraform"] },
  { id: "nginx", name: "NGINX", icon: "NGINX.svg", files: ["nginx.conf"] },
];

/** Icons used elsewhere in the app (buttons and connectors), copied the same way. */
export const toolIcons: Record<string, string> = {
  vscode: "Visual-Studio-Code-(VS-Code).svg",
  jira: "Jira.svg",
  confluence: "Confluence.svg",
  git: "Git.svg",
  powershell: "Powershell.svg",
};

const matches = (pattern: string, name: string) =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i").test(name);

/**
 * The repository's stack, in the order of techRules. `packages` holds every
 * dependency and devDependency name; `entries` the names at the repository root
 * (folders with a trailing "/" stripped) plus ".github/workflows" when present.
 */
export function detectStack(packages: string[], entries: string[]) {
  const found: string[] = [];
  for (const rule of techRules) {
    const byDep = rule.deps?.some((dep) =>
      dep.endsWith("/") ? packages.some((name) => name.startsWith(dep)) : packages.includes(dep),
    );
    const byFile = rule.files?.some((pattern) => entries.some((entry) => matches(pattern, entry)));
    if (byDep || byFile) found.push(rule.id);
  }
  // JavaScript only when there is a package.json and no TypeScript.
  if (found.includes("node") && !found.includes("typescript")) found.splice(found.indexOf("node"), 0, "javascript");
  return found;
}

export const techById = new Map(techRules.map((rule) => [rule.id, rule]));
