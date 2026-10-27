import React from "react";
import type { Translate } from "./locales.ts";

export class PageBoundary extends React.Component<
  { t: Translate; children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
  componentDidCatch(error: Error) {
    console.error("[nekobot] page render failed", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="nkw-view-failure">
        <p>{this.props.t("viewFailed")}</p>
        <pre>{this.state.error.message}</pre>
        <button type="button" onClick={() => this.setState({ error: null })}>
          {this.props.t("refresh")}
        </button>
      </div>
    );
  }
}
