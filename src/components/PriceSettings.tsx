import { CircleDollarSign, RotateCcw } from "lucide-react";
import { EngineMark } from "@/components/EngineMark";
import {
  normalizeModel,
  priceFor,
  priceSources,
  pricesCheckedOn,
  type ModelPrice,
} from "../../shared/pricing";
import type { Engine, Model } from "../../shared/types";

const fields: { key: keyof ModelPrice; label: string }[] = [
  { key: "input", label: "Input" },
  { key: "cachedInput", label: "Cached input" },
  { key: "cacheWrite", label: "Cache write" },
  { key: "output", label: "Output" },
];

/**
 * Prices used for the cost estimates on each run, for the models your agents
 * can use. List prices are filled in; change a value to use your own price
 * (for example a negotiated rate), Reset to go back to the list price.
 */
export function PriceSettings({
  models,
  prices,
  onChange,
  onOpen,
}: {
  models: { engine: Engine; model: Model }[];
  prices: Record<string, ModelPrice>;
  onChange: (prices: Record<string, ModelPrice>) => void;
  onOpen: (url: string) => void;
}) {
  // One row per model id (Copilot and Codex can offer the same model).
  const rows = models.filter(
    (row, index) =>
      row.model.id !== "auto" &&
      models.findIndex((other) => normalizeModel(other.model.id) === normalizeModel(row.model.id)) === index,
  );
  return (
    <details className="panel price-settings">
      <summary>
        <CircleDollarSign size={17} /> Prices for cost estimates
      </summary>
      <p className="muted-note">
        US dollars per 1 million tokens. List prices were checked on {pricesCheckedOn}; change
        one to use your own. Copilot runs use the AI credits Copilot reports when it reports
        them, and Claude runs use Claude's own API-price figure, unless you set a price here.
      </p>
      {rows.length ? (
        <div className="price-table">
          <table>
            <thead>
              <tr>
                <th>Model</th>
                {fields.map((field) => (
                  <th key={field.key} className="num">
                    {field.label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ engine, model }) => {
                const key = normalizeModel(model.id);
                const own = prices[key];
                const list = priceFor(model.id);
                const shown: Partial<ModelPrice> = own ?? list ?? {};
                const set = (field: keyof ModelPrice, raw: string) => {
                  const value = raw === "" ? undefined : Number(raw);
                  if (value !== undefined && (!Number.isFinite(value) || value < 0)) return;
                  const base: ModelPrice = {
                    input: shown.input ?? 0,
                    cachedInput: shown.cachedInput ?? 0,
                    output: shown.output ?? 0,
                    ...(shown.cacheWrite !== undefined ? { cacheWrite: shown.cacheWrite } : {}),
                  };
                  const next = { ...base, [field]: value ?? 0 };
                  if (field === "cacheWrite" && value === undefined) delete next.cacheWrite;
                  onChange({ ...prices, [key]: next });
                };
                return (
                  <tr key={`${engine}:${model.id}`} className={own ? "custom" : undefined}>
                    <td>
                      <span className="price-model">
                        <EngineMark engine={engine} size={14} />
                        <span>
                          {model.name}
                          <small>
                            {own
                              ? "Your price"
                              : list
                                ? `List price · ${list.label}`
                                : "No list price: enter one to estimate cost"}
                          </small>
                        </span>
                      </span>
                    </td>
                    {fields.map((field) => (
                      <td key={field.key} className="num">
                        <input
                          type="number"
                          min={0}
                          step="0.001"
                          inputMode="decimal"
                          aria-label={`${model.name} ${field.label} price`}
                          value={shown[field.key] ?? ""}
                          placeholder={field.key === "cacheWrite" ? "= input" : "—"}
                          onChange={(event) => set(field.key, event.target.value)}
                        />
                      </td>
                    ))}
                    <td>
                      {own && (
                        <button
                          type="button"
                          className="text-button"
                          title="Use the list price again"
                          onClick={() => {
                            const next = { ...prices };
                            delete next[key];
                            onChange(next);
                          }}
                        >
                          <RotateCcw size={13} /> Reset
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p>Connect Codex, Claude or GitHub Copilot to see their models here.</p>
      )}
      <p className="muted-note">
        Sources:{" "}
        {priceSources.map((url, i) => (
          <span key={url}>
            {i ? ", " : ""}
            <button type="button" className="text-button" onClick={() => onOpen(url)}>
              {new URL(url).hostname}
            </button>
          </span>
        ))}
        . Save agents to keep your changes.
      </p>
    </details>
  );
}
