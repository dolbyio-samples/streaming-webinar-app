const sleep = (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

function startSpeakerDetection(viewer) {
    setInterval(async () => {

        const pc = await viewer.getRTCPeerConnection();
        const stats = await pc.getStats();
        for (const [_, stat] of stats) {
            if (stat.kind == "audio" && stat.trackIdentifier) {
                const transceiver = pc.getTransceivers().find(t => t.receiver.track.id == stat.trackIdentifier);

                const midElements = document.querySelectorAll('[data-media-ids]');
                for (let i = 0; i < midElements.length; i++) {
                    const element = midElements[i];

                    const mediaId = element.getAttribute('data-media-ids')
                        .split(',')
                        .find((mid) => mid == transceiver.mid);
                    
                    if (mediaId) {
                        if (stat.audioLevel > 0.15) {
                            element.classList.add('active');
                        } else {
                            element.classList.remove('active');
                        }
                        break;
                    }
                }
            }
        }
    
    }, 1000);
}

async function startPublishing(publishToken, streamName, participantName) {
    console.log('Start publishing');

    const tokenGenerator = () => millicast.Director.getPublisher({
        token: publishToken,
        streamName: streamName,
    });

    const millicastPublish = new millicast.Publish(streamName, tokenGenerator)

    const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: {
            height: { max: 360 },
            width: { max: 480 },
        }
    });

    await millicastPublish.connect({
        mediaStream: mediaStream,
        sourceId: participantName,
    });

    const template = jsrender.templates(`
        <li id="local-participant" class="list-group-item">
            <video id="local-video" controls="false" autoplay="true"></video><br />
            <span class="participant-name"> ${participantName} (<i>me</i>) </span>
        </li>
    `);
    const rendering = template.render();

    const participantsDiv = document.getElementById("participants");
    participantsDiv.insertAdjacentHTML('afterend', rendering);

    const videoElement = document.getElementById("local-video");
    const stream = new MediaStream(mediaStream.getVideoTracks());
    videoElement.srcObject = stream;
    videoElement.play();

    //const participantElement = document.getElementById('local-participant');
    //startSpeakerDetection(mediaStream, participantElement);
}

async function onBroadcastEvent(event, viewer) {
    console.log("broadcastEvent", event);

    if (event.name === "active") {

        const sourceId = event.data.sourceId;
        console.log('Source ID', sourceId);

        const mediaStream = new MediaStream();

        let audioMediaId, videoMediaId;
        let audioTrackId, videoTrackId;

        const trackAudio = event.data.tracks?.find(({ media }) => media === 'audio');
        if (trackAudio) {
            const audioTransceiver = await viewer.addRemoteTrack('audio', [mediaStream]);
            audioMediaId = audioTransceiver?.mid ?? undefined;
            audioTrackId = trackAudio.trackId;
        }
    
        const trackVideo = event.data.tracks?.find(({ media }) => media === 'video');
        if (trackVideo) {
            const videoTransceiver = await viewer.addRemoteTrack('video', [mediaStream]);
            videoMediaId = videoTransceiver?.mid ?? undefined;
            videoTrackId = trackVideo.trackId;
        }

        const mapping = [];
        if (audioMediaId) {
            mapping.push({
                media: 'audio',
                trackId: audioTrackId,
                mediaId: audioMediaId,
            });
        }
        if (videoMediaId) {
            mapping.push({
                media: 'video',
                trackId: videoTrackId,
                mediaId: videoMediaId,
            });
        }

        const template = jsrender.templates(`
            <li id="participant-${sourceId}" data-media-ids="${mapping.map(m => m.mediaId).join(",")}" class="list-group-item">
                <video id="video-${sourceId}" controls="false" autoplay="true"></video><br />
                <span class="participant-name"> ${sourceId} </span>
            </li>
        `);
        const rendering = template.render();

        const participantsDiv = document.getElementById("participants");
        participantsDiv.insertAdjacentHTML('afterend', rendering);

        const videoElement = document.getElementById(`video-${sourceId}`);
        videoElement.srcObject = mediaStream;
        videoElement.width = 480;
        videoElement.height = 360;
        videoElement.play();

        console.log('About to project Source ID:', sourceId, '-> Track ID:', audioTrackId, videoTrackId);
        await viewer.project(sourceId, mapping);
        console.log('Projected');

    } else if (event.name === "inactive") {

        const participantElement = document.getElementById(`participant-${event.data.sourceId}`);
        const mediaIds = participantElement.getAttribute('data-media-ids').split(',');
        participantElement.remove();

        console.log('About to unproject', mediaIds);
        await viewer.unproject(mediaIds);

    } else if (event.name === 'viewercount') {
        const viewerCount = event.data.viewercount;
        const viewerCountElement = document.getElementById("viewerCount");
        viewerCountElement.innerHTML = `${viewerCount} online viewers`;
    }
}

async function startListening(streamAccountId, streamName, excludedSourceId) {
    console.log('Start listening');

    const tokenGenerator = () => millicast.Director.getSubscriber({
        streamName: streamName,
        streamAccountId: streamAccountId,
    });

    const viewer = new millicast.View(streamName, tokenGenerator);
    viewer.on("broadcastEvent", (event) => onBroadcastEvent(event, viewer));

    const excludedSourceIds = excludedSourceId ? [excludedSourceId] : null;

    do {
        try {
            await viewer.connect({
                events: ['active', 'inactive', 'viewercount'],
                excludedSourceIds: excludedSourceIds
            });

            startSpeakerDetection(viewer);

            return;
        } catch (error) {
            if (error.message === 'stream not being published') {
                await sleep(3);
            } else {
                console.error(error);
                return;
            }
        }
    } while (true);
}
