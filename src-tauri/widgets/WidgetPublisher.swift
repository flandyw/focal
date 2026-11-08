import Foundation
import WidgetKit

@main
struct WidgetPublisher {
    static func main() {
        do {
            umask(0o077)
            var input = Data()
            while let chunk = try FileHandle.standardInput.read(upToCount: 64 * 1024), !chunk.isEmpty {
                input.append(chunk)
                guard input.count <= 512 * 1024 else { throw CocoaError(.fileWriteOutOfSpace) }
            }
            let url = try WidgetSnapshot.fileURL()
            if String(data: input, encoding: .utf8) == "null" {
                if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
            } else {
                let value = try JSONDecoder().decode(WidgetSnapshot.self, from: input)
                guard value.version == 1, value.updatedAt.isFinite, value.agenda.count <= 100,
                      value.exams.count <= 100, value.days.count <= 8,
                      (value.atar?.subjects.count ?? 0) <= 20 else { throw CocoaError(.coderInvalidValue) }
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try input.write(to: url, options: .atomic)
                try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
            }
            WidgetCenter.shared.reloadAllTimelines()
        } catch {
            FileHandle.standardError.write(Data("Could not publish widget data: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }
}
