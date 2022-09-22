import type { Player } from "../room-activity";
import type { Room } from "../rooms";
import type { User } from "../users";
import type { ComponentBase } from "./components/component-base";

export interface IQuietPMButtonOptions {
	disabled?: boolean;
	enabledReadonly?: boolean;
	selected?: boolean;
	selectedAndDisabled?: boolean;
	style?: string;
}

export const CLOSE_COMMAND = 'closehtmlpage';
export const SWITCH_LOCATION_COMMAND = 'switchhtmlpagelocation';

export abstract class HtmlPageBase {
	abstract pageId: string;

	baseChatUhtmlName: string = "";
	chatUhtmlName: string = "";
	closed: boolean = false;
	destroyed: boolean = false;
	closeButtonHtml: string = "";
	components: ComponentBase[] = [];
	globalRoomPage: boolean = false;
	lastRender: string = '';
	readonly: boolean = false;
	closingSnapshot: boolean = false;
	showSwitchLocationButton: boolean = false;
	staffUserView: boolean = false;
	switchLocationButtonHtml: string = "";
	usedCommandAfterLastRender: boolean = false;

	baseCommand: string;
	commandPrefix: string;
	pageList: Dict<HtmlPageBase>;
	room: Room;

	isRoomStaff!: boolean;
	userName!: string;
	userId!: string;

	constructor(room: Room, userOrPlayer: User | Player, baseCommand: string, pageList: Dict<HtmlPageBase>) {
		this.room = room;
		this.baseCommand = baseCommand;
		this.commandPrefix = Config.commandCharacter + baseCommand + " " + (room.alias || room.id);
		this.pageList = pageList;

		this.setUser(userOrPlayer);

		if (userOrPlayer.id in pageList) pageList[userOrPlayer.id].destroy();
		pageList[userOrPlayer.id] = this;
	}

	abstract render(onOpen?: boolean): string;

	destroy(): void {
		if (this.destroyed) throw new Error(this.pageId + " page already destroyed for user " + this.userId);

		for (const component of this.components) {
			component.destroy();
		}

		delete this.pageList[this.userId];

		this.destroyed = true;
		Tools.unrefProperties(this, ['closed', 'destroyed', 'pageId', 'userName', 'userId']);
	}

	open(): void {
		this.send(true);
	}

	close(): void {
		if (!this.closed && !this.closingSnapshot) {
			const user = Users.get(this.userId);
			if (user) this.getPmRoom().closeHtmlPage(user, this.pageId);

			this.closed = true;

			if (this.onClose) this.onClose();
		}

		this.destroy();
	}

	temporarilyClose(): void {
		if (!this.closed) {
			const user = Users.get(this.userId);
			if (user) this.getPmRoom().closeHtmlPage(user, this.pageId);

			this.closed = true;
		}
	}

	sendClosingSnapshot(): void {
		if (!this.closed) {
			this.closingSnapshot = true;

			const user = Users.get(this.userId);
			if (user) {
				const render = this.render();
				if (this.chatUhtmlName) {
					this.getPmRoom().sayPrivateUhtml(user, this.chatUhtmlName, render);
				} else {
					this.getPmRoom().sendHtmlPage(user, this.pageId, render);
				}
			}
		}

		this.destroy();
	}

	switchLocation(): void {
		let closeHtmlPage = true;
		if (this.chatUhtmlName) {
			closeHtmlPage = false;
			this.chatUhtmlName = "";
		} else {
			this.chatUhtmlName = this.baseChatUhtmlName;
		}

		this.usedCommandAfterLastRender = true;
		this.setSwitchLocationButton();
		this.setCloseButton();

		const user = Users.get(this.userId);
		if (user) {
			if (closeHtmlPage) {
				this.temporarilyClose();
			} else {
				this.getPmRoom().sayPrivateUhtml(user, this.baseChatUhtmlName, "<div>Successfully moved to an HTML page.</div>");
			}
		}

		this.send();
	}

	setUser(userOrPlayer: User | Player): void {
		this.userName = userOrPlayer.name;
		this.userId = userOrPlayer.id;

		const user = Users.get(userOrPlayer.name);
		this.isRoomStaff = user ? user.hasRank(this.room, 'driver') || user.isDeveloper() : false;
	}

	onRenameUser(userOrPlayer: User | Player, oldId: string): void {
		if (!(oldId in this.pageList)) return;

		if (oldId === userOrPlayer.id) {
			this.userName = userOrPlayer.name;
			return;
		}

		if (userOrPlayer.id in this.pageList) {
			this.pageList[oldId].destroy();
		} else {
			this.setUser(userOrPlayer);
			this.pageList[userOrPlayer.id] = this;
		}

		delete this.pageList[oldId];
	}

	getPmRoom(): Room {
		return this.room;
	}

	exceedsMessageSizeLimit(): boolean {
		return Client.exceedsMessageSizeLimit("/sendhtmlpage " + this.userId + "," + this.pageId + "," + this.render());
	}

	send(onOpen?: boolean, forceSend?: boolean): void {
		if (this.destroyed) return;

		if (this.beforeSend && !this.beforeSend(onOpen)) return;

		const user = Users.get(this.userId);
		if (!user) return;

		const render = this.render(onOpen);
		if (render === this.lastRender && !this.usedCommandAfterLastRender && !this.closed && !forceSend) return;

		this.lastRender = render;
		this.usedCommandAfterLastRender = false;
		this.closed = false;

		if (this.chatUhtmlName) {
			this.getPmRoom().sayPrivateUhtml(user, this.chatUhtmlName, render);
		} else {
			this.getPmRoom().sendHtmlPage(user, this.pageId, render);
		}

		if (this.onSend) this.onSend(onOpen);
	}

	checkComponentCommands(componentCommand: string, targets: readonly string[]): string | undefined {
		for (const component of this.components) {
			if (component.active && component.componentCommand === componentCommand) {
				this.usedCommandAfterLastRender = true;
				return component.tryCommand(targets);
			}
		}

		return "Unknown sub-command '" + componentCommand + "'.";
	}

	getQuietPmButton(message: string, label: string, options?: IQuietPMButtonOptions): string {
		let disabled = this.closingSnapshot || this.staffUserView || (options && (options.disabled || options.selectedAndDisabled));
		if (!disabled && options && !options.enabledReadonly && this.readonly) disabled = true;

		let style = options && options.style ? options.style : "";
		if (options && (options.selected || options.selectedAndDisabled)) {
			if (style && !style.endsWith(';')) style += ';';
			style += 'border-color: #ffffff;';
		}

		return Client.getQuietPmButton(this.getPmRoom(), message, label, disabled, style);
	}

	setCloseButton(options?: IQuietPMButtonOptions): void {
		if (this.chatUhtmlName) {
			this.closeButtonHtml = "";
		} else {
			this.closeButtonHtml = this.getQuietPmButton(this.commandPrefix + (this.globalRoomPage ? " " : ", ") + CLOSE_COMMAND,
				"Close page", options);
		}
	}

	setSwitchLocationButton(): void {
		if (this.showSwitchLocationButton) {
			this.switchLocationButtonHtml = this.getQuietPmButton(this.commandPrefix + (this.globalRoomPage ? " " : ", ") +
			SWITCH_LOCATION_COMMAND, "Move to " + (this.chatUhtmlName ? "HTML page" : "chat"));
		} else {
			this.switchLocationButtonHtml = "";
		}
	}

	beforeSend?(onOpen?: boolean): boolean;
	onClose?(): void;
	onOpen?(): void;
	onSend?(onOpen?: boolean): void;
}
