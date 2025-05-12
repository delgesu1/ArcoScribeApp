import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

// --- Helper Class to Store Handlers ---
// Make it inherit from NSObject and use @objc to expose to Objective-C
@objc(BackgroundSessionHandlerStore)
public class BackgroundSessionHandlerStore: NSObject {

    // Make it a Singleton
    @objc public static let shared = BackgroundSessionHandlerStore()

    // Private dictionary to store handlers
    private var handlers: [String: () -> Void] = [:]
    private let queue = DispatchQueue(label: "com.arcoscribe.backgroundSessionHandlerQueue") // For thread safety

    // Private init for Singleton
    private override init() {}

    // Method exposed to Objective-C to store a handler
    @objc public func setHandler(for identifier: String, handler: @escaping () -> Void) {
        queue.sync {
            NSLog("[HandlerStore] Storing handler for ID: %@", identifier)
            handlers[identifier] = handler
        }
    }

    // Method exposed to Objective-C to retrieve and remove a handler
    @objc public func getAndRemoveHandler(for identifier: String) -> (() -> Void)? {
        return queue.sync {
            guard let handler = handlers[identifier] else {
                NSLog("[HandlerStore] No handler found for ID: %@", identifier)
                return nil
            }
            NSLog("[HandlerStore] Retrieving and removing handler for ID: %@", identifier)
            handlers.removeValue(forKey: identifier)
            return handler
        }
    }
}
// --- End Helper Class ---


@main
class AppDelegate: RCTAppDelegate {
  // MARK: - Background URL Session Handling

  override func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String, completionHandler: @escaping () -> Void) {
      // Use the Handler Store Singleton to store the handler
      NSLog("[AppDelegate] handleEventsForBackgroundURLSession called for identifier: %@", identifier)
      BackgroundSessionHandlerStore.shared.setHandler(for: identifier, handler: completionHandler)
      // The handler will be retrieved and called later by BackgroundTransferManager
  }

  // MARK: - Standard App Lifecycle Methods

  override func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey : Any]? = nil) -> Bool {
    self.moduleName = "ArcoScribeApp" // Set the main component name
    self.dependencyProvider = RCTAppDependencyProvider() // For React Native setup

    // Optional: Add custom initial props here if needed
    self.initialProps = [:]

    // Call the superclass implementation for standard React Native setup
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // MARK: - React Native Bridge Setup

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    return self.bundleURL()
  }

  override func bundleURL() -> URL? {
    #if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
}
