// Finds the face(s) in each starter portrait with Apple Vision and prints
// {"<id>": {"x":..,"y":..,"w":..,"h":..,"n":..}} with the union box of all faces as
// fractions of the image, origin top-left. Non-human faces Vision misses are omitted.
//   swift scripts/starters/faces.swift public/characters/<id>.webp ...
import AppKit
import Foundation
import Vision

var result: [String: [String: Double]] = [:]
for path in CommandLine.arguments.dropFirst() {
    guard let image = NSImage(contentsOfFile: path),
          let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
    let request = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try? handler.perform([request])
    guard let faces = request.results, !faces.isEmpty else { continue }
    var minX = 1.0, minY = 1.0, maxX = 0.0, maxY = 0.0
    for f in faces {
        let b = f.boundingBox  // normalized, origin bottom-left
        minX = min(minX, Double(b.minX)); maxX = max(maxX, Double(b.maxX))
        minY = min(minY, 1 - Double(b.maxY)); maxY = max(maxY, 1 - Double(b.minY))
    }
    let id = URL(fileURLWithPath: path).deletingPathExtension().lastPathComponent
    result[id] = ["x": minX, "y": minY, "w": maxX - minX, "h": maxY - minY, "n": Double(faces.count)]
}
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
