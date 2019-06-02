const request = require('request');
const cheerio = require('cheerio');
const PixivAppApi = require('pixiv-app-api');
const PixivImg = require('pixiv-img');
const TelegramBot = require('node-telegram-bot-api');
const assert = require('assert');
const fs = require('fs');
const Queue = require('better-queue');
const jsonfile = require('jsonfile');

// argument check
if(!process.argv[2] || !process.argv[3] || !process.argv[4]) {
	console.log('usage: node main.js {token} {pixiv id} {pixi pw}');
	exit();
}

// define regular expression with frequently used
let REGEX_URL = /http(s)?:/;
let REGEX_TWITTER = /twitter\.com/;
let REGEX_FILENAME = /[^/]+\.[a-z0-9]*$/i;
let REGEX_PIXIV = /pixiv\.net/;
let REGEX_RULIWEB = /ruliweb\.com/;

let save_path = 'D:\\images\\out\\';
const DELAY = 250;

// load telegram api
const token = process.argv[2];
const tbot = new TelegramBot(token, {polling: true});
const TELEGRAM_URL = 'https://api.telegram.org/file/bot' + token + '/';
console.log('[SYSTEM] TelegramBot is created successfuly!');

// load pixiv api
const pixiv = new PixivAppApi(process.argv[3], process.argv[4]);
console.log('[SYSTEM] Succeed to login in in pixiv');

// Check whether there is proper save path.
// If there is no such path, create new one.
try {
	if(!fs.existsSync(save_path))
		fs.mkdirSync(save_path);
} catch(e) {
	console.log('[ERROR] Error occured while making new directory: '+ save_path);
	console.log(e);
}

// load machine state file
const STATE_FILE_PATH = '/state.json';
let state = jsonfile.readFileSync(STATE_FILE_PATH, {'throws':false});
if(state == null) {
	// file has not been loaded properly
	state = {
		last_chat_id: null
	};
}
if(state.last_chat_id != null) {
	tbot.sendMessage(state.last_chat_id, 'IIONA 부팅 완료');
}

/*
	POST IMAGE ROUTING
*/
let queued_cnt = 0;
let success_cnt = 0;
let task_queue = new Queue(function(input, cb) {
	// input[0] is processing function
	// input[1] is target message
	update_chat_id(input[1]);
	queued_cnt += 1;
	input[0](input[1], cb);
});

task_queue.on('task_finish', function(task_id, result, stats) {
	success_cnt += 1;
});

task_queue.on('drain', function() {
	// report to user the result of processing
	tbot.sendMessage(state.last_chat_id, `작업완료: 총 ${queued_cnt}개, 성공 ${success_cnt}개`);
	queued_cnt = 0;
	success_cnt = 0;
});

//tbot.sendMessage()

function update_chat_id(msg) {
	state.last_chat_id = msg.chat.id;
	jsonfile.writeFileSync(STATE_FILE_PATH, state);
};

// bot test code
tbot.onText(/\/test/, (msg, match) => {
	tbot.sendMessage(msg.chat.id, 'hello~');
});

// 직접 봇에게 이미지 공유를 한 경우
tbot.on('photo', msg => {
	task_queue.push([async (msg, queue_cb) => {
		const file_id = msg.photo[msg.photo.length - 1].file_id;
		try {
			let res = await tbot.getFile(file_id); 
			await save_img(TELEGRAM_URL + res.file_path);
			queue_cb(null, true);
		}
		catch(err) {
			console.log('[WARNING] Failed to download image from msg:');
			console.log(msg);
			console.log('caused by');
			console.log(err);
			queue_cb(null, false);
		}
	}, msg]);
});

// URL이 포함된 메시지를 공유한 경우
tbot.onText(/http(s)?:\/\//, (msg, match) => {
	task_queue.push([async (msg, queue_cb) => {
		console.log('[SYSTEM] URL has been detected in:');
		console.log('   ' + msg.text);
		try {
			msg.entities.forEach(async (entity) => {
				if(entity.type == 'url')
					await classify_url(msg.text.slice(entity.offset, entity.offset + entity.length));
			});			
			queue_cb(null, true);
		}
		catch(e) {
			console.log(e);
			queue_cb(null, false);
		}
	}, msg]);
});

/*
	Check url and return the proper finder
	to extract image. If there is no matched
	finder, return null.
*/
function classify_url(url) {
	return new Promise(async (resolve, reject) => {
		try {
			if(REGEX_TWITTER.test(url))
				await find_img_url_twitter(url);
			else if(REGEX_PIXIV.test(url))
				find_img_url_pixiv(url);
			else if(REGEX_RULIWEB.test(url))
				find_img_url_ruliweb(url);
			else {
				console.log('[WARNING] classify_url: Cannot classify the given url:');
				console.log(url);
			}
			resolve();
		}
		catch(err) {
			reject(err);
		}
	});
}

/*
	트위터는 사용자의 이미지를 https://pbs.twimg.com/media/~~
	에 저장한다. 하지만 사용자가 요청한 페이지에 이런 이미지가
	한 장이라는 보장은 없다. 계정 헤더나 프로필 사진 역시 이런
	주소가 포함돼 있다.

	트윗에 올린 이미지는 <div class='AdaptiveMedia-container'>
	의 자식 DOM에 존재한다. 업로드된 이미지의 숫자에 따라 내부
	구조가 조금씩 다르기는 하지만, 확실한 건 추출해야 할 이미지는
	반드시 이 DOM 내부에 다 들어있다는 것이다.

	위에 것만 적용했더니 답글에 있는 이미지까지 끌어와서, 좀 더
	스코프를 좁혀야 한다. 전체 스코프는 다음과 같다.

	<div class='permalink-inner ...'>
		<div class='~'>
			<div class='AdaptiveMedia-container'>
				<div ~>
					<div ~
						<div ~>
							<img data-aria-label-part src="url" ~>
	2019-05-05 기준
*/
function find_img_url_twitter(url) {
	assert.ok(url);
	console.log('[SYSTEM] Classified as Twitter');
	return new Promise(async (resolve, reject) => {
		request(url, (err, res, body) => {
			if(!!err) {
				console.log('[ERROR] find_img_url_twitter failed to parse page');
				console.log('caused by:');
				console.log(err);
				reject(err);
			}
			else {
				let $ = cheerio.load(body);
				try {
					let result = $('.permalink-inner .AdaptiveMedia-container')
						.find('img')
						.each(async (idx, val)=>{
							console.log($(val).attr('src'));
							await save_img($(val).attr('src'));
						});
					resolve();
				}
				catch(err) {
					reject(err);
				}
			}
		});
	});
};

/*
	픽시브에서 GET으로 받아올 수 있는 페이지에는 정작
	일러스트가 포함돼 있지 않다. 브라우저에서 페이지 로드가
	완료된 이후 이미지를 동적으로 표시하기 때문이다.

	때문에 직접 페이지를 파싱하기보다는 API를 사용하는 것이
	정신건강에 이롭다.

	akameco/pixiv-app-api를 사용하여 illustDetail(id)로
	JSON을 받아온 뒤, metaPages에 들어있는 URL을 활용하여
	저장하면 된다.

	이때 pixiv 측에서 일반적인 요청은 400 에러로 블락해버리기
	때문에, akameco/pixiv-img 모듈을 써서 다운받아야 한다.

	2019-05-01 기준
*/
function find_img_url_pixiv(url) {
	assert.ok(url);
	console.log('[SYSTEM] Classified as Pixiv');

	// extract image id
	let img_id = url.match(/illust_id=[0-9]+/)[0];
	img_id = img_id.match(/[0-9]+/)[0];
	
	// process
	pixiv.illustDetail(img_id)
		.then(json => {
			if(json.illust.metaPages.length > 0) {
				// Case when there are more than one image
				delayed_forEach(json.illust.metaPages, DELAY, meta_info => {
					// extract filename from url and make output path
					save_img_pixiv(meta_info.imageUrls.original);
				});
			} else {
				// Case when there is only one image
				save_img_pixiv(json.illust.imageUrls.large);
			}
		})
		.catch(err => {
			console.log('[WARNING] find_img_url_pixiv: error has been occured while fetching metadata');
			console.log(url);
			console.log('caused by');
			console.log(err);
		});
}

/*
	이 사이트는 좀 이상해서 이미지 URI에 https가 붙어있는
	경우도 있고 없는 경우도 있다. 때문에 잘 구분을 해줘야 한다.

	구조

	<div class='view_content'>
		<div class='row'>
			<p ~>
				<span ~>
					<a ~>
						<img class='lazy_read'
*/
function find_img_url_ruliweb(url) {
	assert.ok(url);
	console.log('[SYSTEM] Classified as Ruliweb');
	request(url, function(err, res, body) {
		if(err)
			console.log(err);
		let $ = cheerio.load(body);
		let result = $('div.view_content')
			.find('img')
			.each((idx, val)=>{
				setTimeout(() => {
					let uri = $(val).attr('src');
					if(!REGEX_URL.test(uri))
						uri = 'https:' + uri;
					save_img(uri);
				}, idx * DELAY);
			});
	});
}

/*
	url을 요청하여 저장한다.
	
	이 함수가 만능은 아닌 것이, 이따금 파일 경로를 직접
	요청하면 블락하는 사이트도 존재한다. (ex: pixiv)
	이 경우 다른 방법을 생각해내야 한다.
*/
function save_img(url) {
	return new Promise(async (resolve, reject) => {
		let fname = extract_filename(url);
		console.log('FILE NAME = ' + fname);
		let fos = fs.createWriteStream(save_path + '/' + fname[0]);
		try {
			request(url)
			.pipe(fos)
			.on('finish', () => {
				console.log('[SYSTEM] Finished downloading: ' + fname[0]);
				console.log('  from ' + url);
				resolve();
			})
			.on('error', (err) => {
				console.log('[WARNING] save_img: error has been occured from fs:');
				console.log(err);
				reject(err);
			});
		} catch(e) {
			reject(err);
		}
	});
};

/**
	pixiv는 전용 API를 이용하여 다운로드해야 한다.
*/
function save_img_pixiv(url) {
	let fname = extract_filename(url);
	PixivImg(url, save_path + '/' + fname)
		.then(out => {
			console.log('[SYSTEM] Finished downloading: ' + out);
		})
		.catch(err => {
			console.log('[WARNING] save_img_pixiv: error has been occured while saving image');
			console.log(err.message);
		});
};

/**
	url에서 디렉토리를 제외한 순수 이미지 파일이름만 추출한다.
	그런게 없으면 null을 반환한다.
*/
function extract_filename(url) {
	let fname = url.match(REGEX_FILENAME);
	if(fname == null) {
		console.log('[WARNING] cannot extract filename');
		console.log('   from: ' + url);
	}
	return fname;
}

/**
	밴 안먹기 위한 대응책
	forEach의 콜백이 비동기인 경우, 매우 빠른 속도로
	서버에 요청을 날릴 수 있다. 이를 방지하기 위한 것.
*/
function delayed_forEach(arr, delay, callback) {
	assert.ok(arr instanceof Array);
	arr.forEach((val, idx, arr) => {
		setTimeout(callback, idx * delay, val, idx, arr);
	});
}