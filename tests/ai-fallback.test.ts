import { beforeEach, describe, expect, it, vi } from "vitest";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn<(options: { tools?: ToolSet }) => Promise<unknown>>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("ai", async (importOriginal) => ({
  ...await importOriginal<typeof import("ai")>(),
  generateText: generateTextMock,
}));
vi.mock("@ai-sdk/groq", () => ({ createGroq: () => (model: string) => ({ modelId: model }) }));
vi.mock("@ai-sdk/google", () => ({ createGoogle: () => (model: string) => ({ modelId: model }) }));
vi.mock("@/lib/env", () => ({ env: {
  groqKey: () => "test-only",
  groqModel: () => "primary",
  groqFallbackModel: () => "secondary",
  groqFastModel: () => "fast",
  geminiKey: () => "test-only",
  geminiModel: () => "last",
} }));

import { generateWithFallback } from "@/lib/ai/provider";

const options = { system: "Test", messages: [] };
const executionOptions = { toolCallId: "test", messages: [], context: undefined };

describe("repli IA sans rejouer les actions d'un outil", () => {
  beforeEach(() => { generateTextMock.mockReset(); });

  it("bascule toujours de modèle quand l'échec précède tout outil", async () => {
    const execute = vi.fn(async () => ({ id: "created" }));
    const inputSchema = z.object({ name: z.string() });
    const definition = Object.freeze(tool({ description: "Créer", inputSchema, execute }));
    generateTextMock.mockRejectedValueOnce(new Error("quota")).mockResolvedValueOnce({ text: "ok" });

    const output = await generateWithFallback({ ...options, tools: { create: definition } });

    expect(output).toMatchObject({ provider: "groq", model: "secondary", fallbackErrors: ["groq: quota"] });
    expect(generateTextMock).toHaveBeenCalledTimes(2);
    expect(generateTextMock.mock.calls[0][0].tools?.create.inputSchema).toBe(inputSchema);
    expect(definition.execute).toBe(execute);
    expect(execute).not.toHaveBeenCalled();
  });

  it("ne rejoue pas une écriture si le fournisseur échoue après l'outil", async () => {
    const failure = new Error("réponse interrompue après création");
    const execute = vi.fn(async ({ name }: { name: string }) => ({ id: "created", name }));
    const onInputAvailable = vi.fn();
    const definition = tool({ description: "Créer un compte", inputSchema: z.object({ name: z.string() }), execute, onInputAvailable });
    generateTextMock.mockImplementationOnce(async ({ tools }) => {
      expect(tools?.create.description).toBe(definition.description);
      expect(tools?.create.onInputAvailable).toBe(onInputAvailable);
      await expect(tools!.create.execute!({ name: "Compte" }, executionOptions)).resolves.toEqual({ id: "created", name: "Compte" });
      throw failure;
    }).mockResolvedValue({ text: "ne doit pas être appelé" });

    await expect(generateWithFallback({ ...options, tools: { create: definition } })).rejects.toBe(failure);
    expect(execute).toHaveBeenCalledExactlyOnceWith({ name: "Compte" }, executionOptions);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("bloque également le repli si l'outil lui-même échoue (asynchrone : %s)", async (asynchronous) => {
    const failure = new Error("échec après écriture partielle");
    let writes = 0;
    const execute = vi.fn((): Promise<{ id: string }> => {
      writes++;
      if (asynchronous) return Promise.reject(failure);
      throw failure;
    });
    generateTextMock.mockImplementationOnce(async ({ tools }) => {
      await tools!.create.execute!({}, executionOptions);
      throw new Error("inaccessible");
    }).mockResolvedValue({ text: "ne doit pas être appelé" });

    await expect(generateWithFallback({ ...options, tools: { create: tool({ inputSchema: z.object({}), execute }) } })).rejects.toBe(failure);
    expect(writes).toBe(1);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it("préserve les outils sans execute et le résultat d'une génération réussie", async () => {
    const external = tool({ description: "Externe", inputSchema: z.object({}) });
    const execute = vi.fn(() => ({ count: 1 }));
    const result = { text: "ok" };
    generateTextMock.mockImplementationOnce(async ({ tools }) => {
      expect(tools?.external).toBe(external);
      expect(tools!.read.execute!({}, executionOptions)).toEqual({ count: 1 });
      return result;
    });

    const output = await generateWithFallback({ ...options, tools: { external, read: tool({ inputSchema: z.object({}), execute }) } });
    expect(output.result).toBe(result);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });

  it("préserve les résultats AsyncIterable d'AI SDK 7 sans les transformer en Promise", async () => {
    const failure = new Error("échec après résultat progressif");
    let writes = 0;
    const execute = async function* () { writes++; yield { id: "created" }; };
    generateTextMock.mockImplementationOnce(async ({ tools }) => {
      const output = tools!.create.execute!({}, executionOptions) as AsyncIterable<{ id: string }>;
      expect(Symbol.asyncIterator in output).toBe(true);
      const results = [];
      for await (const result of output) results.push(result);
      expect(results).toEqual([{ id: "created" }]);
      throw failure;
    }).mockResolvedValue({ text: "ne doit pas être appelé" });

    await expect(generateWithFallback({ ...options, tools: { create: tool({ inputSchema: z.object({}), execute }) } })).rejects.toBe(failure);
    expect(writes).toBe(1);
    expect(generateTextMock).toHaveBeenCalledTimes(1);
  });
});
