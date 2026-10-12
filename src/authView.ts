import { getAccess, signIn, signOut, verifyCode, type Access, type SignInError } from "./auth";
import { DEALERINK_URL } from "./config";
import { t } from "./i18n";

type OkAccess = Extract<Access, { state: "ok" }>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

function link(label: string, href: string): HTMLAnchorElement {
  return el("a", { href, target: "_blank", rel: "noopener", className: "link" }, [label]);
}

function errorText(error: SignInError, invalidKey: string): string {
  if (error === "invalid") return t(invalidKey);
  if (error === "offline") return t("errorOffline");
  return t("errorUnknown");
}

/**
 * Sign-in, two-factor code and plan check, shared by the popup and the editor.
 * Calls onReady once the person may use the editor; until then it owns the
 * container.
 */
export async function mountAuth(
  container: HTMLElement,
  onReady: (access: OkAccess) => void,
): Promise<void> {
  async function refresh() {
    container.replaceChildren(el("p", { className: "muted" }, [t("checking")]));
    render(await getAccess());
  }

  function render(access: Access) {
    container.replaceChildren();
    switch (access.state) {
      case "ok":
        onReady(access);
        return;
      case "signed_out":
        renderSignIn();
        return;
      case "code":
        renderCode(access.factorId, access.email);
        return;
      case "enroll":
        renderNotice(access.email, t("enrollTitle"), t("enrollBody"), {
          label: t("openSecurity"),
          href: `${DEALERINK_URL}/app/settings/security`,
        });
        return;
      case "denied": {
        const body = {
          disabled: t("deniedDisabled"),
          no_dealership: t("deniedNoDealership"),
          no_plan: t("deniedNoPlan"),
          unavailable: t("deniedUnavailable"),
        }[access.reason];
        renderNotice(access.email, t("deniedTitle"), body, {
          label: t("openDealerInk"),
          href: `${DEALERINK_URL}/app`,
        });
        return;
      }
      case "offline":
        renderNotice(access.email, t("offlineTitle"), t("offlineBody"));
        return;
    }
  }

  function renderSignIn() {
    const email = el("input", {
      type: "email",
      required: true,
      autocomplete: "username",
      id: "auth-email",
      className: "input",
    });
    const password = el("input", {
      type: "password",
      required: true,
      autocomplete: "current-password",
      id: "auth-password",
      className: "input",
    });
    const message = el("p", { className: "error", role: "alert" });
    const submit = el("button", { type: "submit", className: "button primary" }, [t("signIn")]);
    const form = el("form", { className: "stack" }, [
      el("h2", { className: "title" }, [t("signInTitle")]),
      el("p", { className: "muted" }, [t("signInBody")]),
      el("label", { htmlFor: "auth-email", className: "label" }, [t("email")]),
      email,
      el("label", { htmlFor: "auth-password", className: "label" }, [t("password")]),
      password,
      message,
      submit,
      el("p", { className: "muted small" }, [
        t("noAccount") + " ",
        link(t("createAccount"), `${DEALERINK_URL}/auth`),
      ]),
    ]);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      message.textContent = "";
      const error = await signIn(email.value, password.value);
      submit.disabled = false;
      if (error) {
        message.textContent = errorText(error, "errorCredentials");
        return;
      }
      await refresh();
    });
    container.append(form);
    email.focus();
  }

  function renderCode(factorId: string, emailAddress: string) {
    const code = el("input", {
      inputMode: "numeric",
      autocomplete: "one-time-code",
      maxLength: 6,
      pattern: "[0-9]{6}",
      required: true,
      id: "auth-code",
      className: "input code",
    });
    const message = el("p", { className: "error", role: "alert" });
    const submit = el("button", { type: "submit", className: "button primary" }, [t("verify")]);
    const form = el("form", { className: "stack" }, [
      el("h2", { className: "title" }, [t("codeTitle")]),
      el("p", { className: "muted" }, [t("codeBody")]),
      el("label", { htmlFor: "auth-code", className: "label" }, [t("code")]),
      code,
      message,
      submit,
      signOutLine(emailAddress),
    ]);
    code.addEventListener("input", () => {
      code.value = code.value.replace(/\D/g, "").slice(0, 6);
      if (code.value.length === 6) form.requestSubmit();
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      message.textContent = "";
      const error = await verifyCode(factorId, code.value);
      submit.disabled = false;
      if (error) {
        message.textContent = errorText(error, "errorCode");
        code.select();
        return;
      }
      await refresh();
    });
    container.append(form);
    code.focus();
  }

  function renderNotice(
    emailAddress: string | null,
    title: string,
    body: string,
    action?: { label: string; href: string },
  ) {
    const retry = el("button", { type: "button", className: "button primary" }, [
      t("checkAgain"),
    ]);
    retry.addEventListener("click", () => void refresh());
    container.append(
      el("div", { className: "stack" }, [
        el("h2", { className: "title" }, [title]),
        el("p", { className: "muted" }, [body]),
        ...(action ? [link(action.label, action.href)] : []),
        retry,
        ...(emailAddress ? [signOutLine(emailAddress)] : []),
      ]),
    );
  }

  function signOutLine(emailAddress: string): HTMLElement {
    const button = el("button", { type: "button", className: "button text" }, [t("signOut")]);
    button.addEventListener("click", async () => {
      await signOut();
      await refresh();
    });
    return el("p", { className: "muted small" }, [
      t("signedInAs", emailAddress) + " ",
      button,
    ]);
  }

  await refresh();
}
