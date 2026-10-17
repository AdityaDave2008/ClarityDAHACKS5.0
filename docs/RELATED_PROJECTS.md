# Related projects and tutorials

Research checked October 16, 2026 for the Clarity hackathon prototype. These references help with detection, camera integration, feedback, or testing. They do not establish that a general iPhone obstacle scanner may keep capturing behind Instagram. The linked projects were inspected through their primary documentation, not built or validated on our phone.

## Best code references

| Reference | Useful parts | Reuse and setup notes |
| --- | --- | --- |
| [Ultralytics YOLO iOS app and Swift package](https://github.com/ultralytics/yolo-ios-app) | Official on-device Core ML inference, camera components, and SwiftUI/UIKit integration. Strong reference for eventually moving detection off our backend. | [AGPL-3.0](https://github.com/ultralytics/yolo-ios-app/blob/main/LICENSE), with alternative commercial licensing. Review code and model terms before incorporating them. This is not a background-camera permission solution. |
| [TensorFlow Lite iOS object-detection example](https://github.com/tensorflow/examples/tree/master/lite/examples/object_detection/ios) | Swift rear-camera capture, MobileNet SSD/COCO inference, confidence filtering, and bounding-box rendering. | [Apache-2.0](https://github.com/tensorflow/examples/blob/master/LICENSE). Uses TensorFlow Lite, not Core ML. Its CocoaPods/Xcode setup instructions are older and need current-device verification. |
| [SeeForMe](https://github.com/SolarEpsilon/SeeForMe) | Close concept: camera/Core ML/Vision detection, speech/VoiceOver, haptics, and optional depth estimation. Useful for accessible feedback and user flow. | README declares MIT, but check actual code/model notices before importing. LiDAR requires compatible hardware; the README's broad iPhone-generation wording is not evidence that every model has LiDAR. |
| [RealTime AI Camera](https://github.com/nicedreamzapp/RealTimeAICam) | Swift camera pipeline, object tracking, spoken output, VoiceOver, and optional LiDAR. Its documentation points to specific camera/detector/feedback files and an Android port. | [AGPL-3.0](https://github.com/nicedreamzapp/RealTimeAICam/blob/main/LICENSE). A broader project than our MVP; use it to study individual components rather than importing its full feature set. |

## YouTube

- [SeeForMe creator-linked demo](https://youtu.be/3lR673M6NpM). The [author's development article](https://medium.com/@r_magnus/building-a-private-ai-assistant-for-the-visually-impaired-with-swift-core-ml-9a8258c4901c) connects the demo and public Swift repository. Useful for understanding the assistive detection/feedback interaction. Exact video title and playback were not independently retrievable.
- [RealTime AI Camera creator-linked demonstration](https://www.youtube.com/watch?v=2BEYv-fv-gE). Its [repository](https://github.com/nicedreamzapp/RealTimeAICam) links this as a 90-second demonstration of detection and spoken assistance. Treat that as the creator's description; playback was not independently inspected.
- [Real-time Core ML camera detection with SwiftUI](https://www.youtube.com/watch?v=xZnN-h3kq54), SwiftUI Codes. Indexed tutorial covering an iOS foreground camera detector. The description links source on Patreon; free access and reuse terms were not established. The video page itself could not be fetched during this research.
- [Getting started with Ultralytics HUB on iOS and Android](https://www.youtube.com/watch?v=AIvrQ7y0aLo), Ultralytics. Useful mobile detection/threshold demonstration; the HUB video and current Swift package are different versions of the product, so do not assume the video is a build tutorial for the current repository.

## Instructables

- [Climbing to New Heights: Elevation Detection and Navigation](https://www.instructables.com/Climbing-to-New-Heights-a-Novel-Device-for-Elevati/). Raspberry Pi camera + YOLOv5 + buzzer wearable. Step 4 discusses the camera/algorithm/testing process; Step 6 reports weaker downhill detection. Useful for camera placement and stair-test design. It is hardware inspiration, not drop-in iPhone code; the inspected page did not expose a complete runnable code package or clear code reuse license.
- [DIY smart walking stick using Arduino UNO](https://www.instructables.com/DIY-Smart-Walking-Stick-for-Visually-Challenged-Us/). Ultrasonic sensor, buzzer, LED, and a pasted Arduino sketch. Useful for the sensor-to-alert loop and a controlled threshold demo. It does not use camera vision or run on iPhone.

## Suggested use during this hackathon

Keep the existing working camera/backend loop. Study SeeForMe and RealTime AI Camera for how to communicate an object to the user; study the official Ultralytics or TensorFlow examples for a later on-device inference option. Use the elevation-detection guide to design controlled tests, including failures. Attribute anything that informs or enters the submission, and preserve the applicable notices when reusing code or models.
