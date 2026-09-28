import { describe, expect, test } from "bun:test"
import {
  buildMistakeAttachmentPath,
  validateSavedMistakeImages,
} from "../src/lib/mistake-attachments"

describe("mistake attachments", () => {
  test("builds an owner-scoped storage path with a safe extension", () => {
    expect(buildMistakeAttachmentPath("user-1", "mistake-1", "image-1", "image/png"))
      .toBe("user-1/mistake-1/image-1.png")
  })

  test("accepts supported images within the attachment limits", () => {
    expect(validateSavedMistakeImages([
      { type: "image/png", size: 1024 },
      { type: "image/jpeg", size: 2048 },
    ], 2)).toBeNull()
  })

  test("rejects unsafe formats, oversized files, and too many images", () => {
    expect(validateSavedMistakeImages([{ type: "image/svg+xml", size: 1024 }])).toContain("JPEG")
    expect(validateSavedMistakeImages([{ type: "image/png", size: 5 * 1024 * 1024 + 1 }])).toContain("5 MB")
    expect(validateSavedMistakeImages([{ type: "image/png", size: 1 }], 5)).toContain("no more than 5")
    expect(validateSavedMistakeImages([{ type: "image/png", size: 2 * 1024 * 1024 }], 4, 19 * 1024 * 1024)).toContain("20 MB")
  })
})
