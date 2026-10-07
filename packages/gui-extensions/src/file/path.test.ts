import { describe, expect, test } from "bun:test"
import { openInAppParentPath, resolveMarkdownRevealPath, resolveOpenInAppPath } from "./path"

describe("resolveOpenInAppPath", () => {
  test("joins relative paths using the workspace separator", () => {
    expect(resolveOpenInAppPath("/workspace/project", "src/file.ts")).toBe("/workspace/project/src/file.ts")
    expect(resolveOpenInAppPath("C:\\workspace\\project", "src/file.ts")).toBe("C:\\workspace\\project\\src\\file.ts")
  })

  test("preserves absolute POSIX, Windows, and UNC paths", () => {
    expect(resolveOpenInAppPath("/workspace", "/tmp/file.ts")).toBe("/tmp/file.ts")
    expect(resolveOpenInAppPath("C:/workspace", "D:\\src\\file.ts")).toBe("D:\\src\\file.ts")
    expect(resolveOpenInAppPath("C:/workspace", "\\\\server\\share\\file.ts")).toBe("\\\\server\\share\\file.ts")
    expect(resolveOpenInAppPath("C:/workspace", "\\src\\file.ts")).toBe("\\src\\file.ts")
  })
})

describe("openInAppParentPath", () => {
  test("preserves POSIX and Windows roots", () => {
    expect(openInAppParentPath("/file.ts")).toBe("/")
    expect(openInAppParentPath("/workspace/file.ts")).toBe("/workspace")
    expect(openInAppParentPath("C:\\file.ts")).toBe("C:\\")
    expect(openInAppParentPath("C:\\workspace\\file.ts")).toBe("C:\\workspace")
    expect(openInAppParentPath("\\\\server\\share\\file.ts")).toBe("\\\\server\\share")
  })
})

describe("resolveMarkdownRevealPath", () => {
  test("keeps decoded file identity while resolving relative and absolute citations", () => {
    const cases = [
      ["D:/project", "releases/a#b.exe", "", "D:/project/releases/a#b.exe"],
      ["D:/project", "releases/a%23b.exe", "", "D:/project/releases/a%23b.exe"],
      ["D:/project", "releases/a%20b.exe", "", "D:/project/releases/a%20b.exe"],
      ["D:/project", "releases/Подарок 100%.exe", "", "D:/project/releases/Подарок 100%.exe"],
      ["D:/project", "E:/Gift folder/a#%23.exe", "", "E:/Gift folder/a#%23.exe"],
      ["D:/project", "src/main.ts:12:3", "", "D:/project/src/main.ts"],
      ["D:/project", "../a#b.exe", "docs", "D:/project/a#b.exe"],
      ["D:/project", "../a#b.exe", "", "D:/a#b.exe"],
      ["D:/project", "../../a#b.exe", "", "D:/a#b.exe"],
      ["D:/project", "../../../a%23.exe", "", "D:/a%23.exe"],
      ["D:/project", "..\\a%20.exe", "", "D:/a%20.exe"],
      ["D:/project", "\\\\server\\share\\a#b.exe", "", "//server/share/a#b.exe"],
      ["\\\\server\\share\\project", "../a#b.exe", "", "//server/share/a#b.exe"],
      ["\\\\server\\share\\project", "../../../a%23.exe", "", "//server/share/a%23.exe"],
      ["/project", "../../a#b", "", "/a#b"],
      ["/project", "releases/a?b#%20", "", "/project/releases/a?b#%20"],
    ]

    for (const [root, href, base, target] of cases) {
      expect(resolveMarkdownRevealPath(root!, href!, base!)).toBe(target!)
    }
  })
})
